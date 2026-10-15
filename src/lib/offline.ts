// Offline Supermix: whole audio files stored in Cache Storage (`mix-<at>`).
// Older audio remains until the user confirms cleanup in Profile.
import { fetchAudioBlob } from './stream'
import { knownDuration, rememberDuration, type Mix } from './taste'
import type { Track } from './data'
import { resetBusy } from './safety'

const KEY = 'ytm.offlineMix'
const PREFIX = 'mix-'
const MIN_FREE = 150 * 1024 * 1024
const path = (ytId: string) => `/offline/${ytId}`

export type OfflineState = { at: number; ids: string[] }
export type Progress = { done: number; total: number; failed: number; at: number }

export const offlineState = (): OfflineState | null => {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
}
export const isOffline = (ytId: string) => Boolean(offlineState()?.ids.includes(ytId))
export function offlineTracks(): Track[] {
  try { return JSON.parse(localStorage.getItem('ytm.offlineTracks') || '[]') } catch { return [] }
}
const supported = () => typeof caches !== 'undefined'

const urls = new Map<string, string>()
/** blob: URL for a downloaded track, or null. */
export async function offlineUrl(ytId: string): Promise<string | null> {
  if (!supported()) return null
  const hit = urls.get(ytId); if (hit) return hit
  const st = offlineState()
  // Tracks of a download in progress are also playable.
  const names = (await caches.keys()).filter((n) => n.startsWith(PREFIX)).sort().reverse()
  if (st) names.unshift(PREFIX + st.at)
  for (const n of new Set(names)) {
    const r = await (await caches.open(n)).match(path(ytId))
    if (r) { const u = URL.createObjectURL(await r.blob()); urls.set(ytId, u); return u }
  }
  return null
}

/** Is the connection suitable for a ~75 MB download (Wi-Fi / unknown, not metered or save-data)? */
export function goodNetwork(): boolean {
  if (!navigator.onLine) return false
  const c = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection
  if (!c) return true
  if (c.saveData) return false
  return !c.type || c.type === 'wifi' || c.type === 'ethernet' || c.type === 'unknown'
}

export async function storageInfo(): Promise<{ used: number; quota: number; persisted: boolean }> {
  const e = await navigator.storage?.estimate?.().catch(() => undefined)
  const persisted = (await navigator.storage?.persisted?.().catch(() => false)) ?? false
  return { used: e?.usage ?? 0, quota: e?.quota ?? 0, persisted }
}

let running: Promise<void> | null = null

export function downloadMix(mix: Mix, onProgress: (p: Progress) => void): Promise<void> {
  if (resetBusy()) return Promise.reject(new Error('Aguarde a limpeza ou restauração terminar.'))
  if (running) return running
  running = run(mix, onProgress).finally(() => { running = null })
  return running
}
export const downloading = () => running !== null || copying

async function run(mix: Mix, onProgress: (p: Progress) => void) {
  if (!supported()) throw new Error('Cache Storage indisponível neste navegador')
  if (offlineState()?.at === mix.at && offlineState()!.ids.length === mix.tracks.length) return
  await navigator.storage?.persist?.().catch(() => false)
  const { used, quota } = await storageInfo()
  if (quota && quota - used < MIN_FREE) throw new Error('Pouco espaço livre (menos de 150 MB)')

  const name = PREFIX + mix.at
  const cache = await caches.open(name)
  const ids = mix.tracks.map((t) => t.ytId)
  const ok: string[] = []
  let failed = 0
  const report = () => onProgress({ done: ok.length, total: ids.length, failed, at: mix.at })
  report()

  const queue = [...ids]
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const track = mix.tracks.find((t) => t.ytId === id)!
      // Register metadata even if this track has no duration yet.
      rememberDuration(id, track.dur || 0, track)
      let saved = false
      for (let attempt = 0; attempt < 3 && !saved; attempt++) {
        try {
          const existing = await cache.match(path(id))
          const blob = existing ? await existing.blob() : await fetchAudioBlob(id)
          track.dur = knownDuration(id, track.dur)
          if (!existing) await cache.put(path(id), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mp4', 'Content-Length': String(blob.size) } }))
          saved = true
        } catch { /* retry */ }
      }
      if (saved) ok.push(id); else failed++
      report()
      // Artwork is optional: never repeat or reject saved audio because a cover failed.
      if (saved) await cacheCovers(id).catch(() => {})
    }
  }
  await Promise.all([worker(), worker()]) // concurrency 2

  if (!ok.length) { await caches.delete(name); throw new Error('Nenhuma faixa pôde ser baixada') }
  if (failed) throw new Error(`${ok.length}/${ids.length} faixas baixadas. Tente novamente para completar; o mix anterior foi preservado.`)
  localStorage.setItem('ytm.supermix', JSON.stringify(mix))
  localStorage.setItem('ytm.offlineTracks', JSON.stringify(mix.tracks))
  localStorage.setItem(KEY, JSON.stringify({ at: mix.at, ids: ok } satisfies OfflineState))
  for (const [id, u] of urls) if (!ok.includes(id)) { URL.revokeObjectURL(u); urls.delete(id) }
}

export async function clearOffline() {
  if (supported()) for (const n of await caches.keys()) if (n.startsWith(PREFIX)) await caches.delete(n)
  for (const u of urls.values()) URL.revokeObjectURL(u)
  urls.clear()
}

async function cacheCovers(id: string) {
  const cache = await caches.open('thumbs')
  for (const size of ['hq', 'mq']) {
    const url = 'https://i.ytimg.com/vi/' + id + '/' + size + 'default.jpg'
    if (await cache.match(url)) continue
    const response = await fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(15000) })
    if (response.type !== 'opaque' && !response.ok) throw new Error('Não foi possível baixar a capa.')
    await cache.put(url, response)
  }
  const keys = await cache.keys()
  for (const key of keys.slice(0, Math.max(0, keys.length - 200))) await cache.delete(key)
}


/** Copy only completed local files, one at a time, while the player has spare capacity. */
let copying = false
export async function mirrorLibrary(tracks: { id: string; status: string; bytes: number }[], plan: Track[], idle: () => boolean) {
  if (copying || resetBusy() || !supported() || localStorage.getItem('ytm.mirrorPaused') === '1') return
  copying = true
  try {
    await navigator.storage?.persist?.().catch(() => false)
    const cache = await caches.open('mix-library')
    for (const track of plan) {
      if (!idle() || resetBusy()) break
      const entry = tracks.find(t => t.id === track.ytId && t.status === 'done')
      if (!entry || isOffline(track.ytId)) continue
      const space = await storageInfo()
      if (space.quota && space.quota - space.used < entry.bytes + MIN_FREE) break
      const response = await fetch('/api/audio?id=' + track.ytId, { headers: { Range: 'bytes=0-', 'X-Stormusic-Purpose': 'download' }, signal: AbortSignal.timeout(30000) })
      if (!response.ok || response.headers.get('x-stormusic-source') !== 'disk') { await response.body?.cancel(); continue }
      const blob = await response.blob()
      if (blob.size !== entry.bytes || !blob.size) continue
      await cache.put(path(track.ytId), new Response(blob, { headers: { 'Content-Type': 'audio/mp4', 'Content-Length': String(blob.size) } }))
      const metadata = offlineTracks().filter(t => t.ytId !== track.ytId)
      metadata.push(track)
      localStorage.setItem('ytm.offlineTracks', JSON.stringify(metadata))
      localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), ids: [...new Set([...(offlineState()?.ids || []), track.ytId])] }))
      window.dispatchEvent(new Event('stormusic-offline'))
      void cacheCovers(track.ytId).catch(() => {})
    }
  } finally { copying = false }
}

export async function removeCachedTrack(id: string) {
  if (copying || running || resetBusy()) throw new Error('Aguarde a cópia offline terminar.')
  const originals: { cache: Cache; response: Response }[] = []
  for (const name of await caches.keys()) if (name.startsWith(PREFIX)) {
    const cache = await caches.open(name), response = await cache.match(path(id))
    if (response) originals.push({ cache, response })
  }
  const backup = await caches.open('stormusic-backup-track-' + id)
  for (const item of originals) await backup.put(path(id), item.response.clone())
  for (const item of originals) await item.cache.delete(path(id))
  localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), ids: (offlineState()?.ids || []).filter(x => x !== id) }))
  localStorage.setItem('ytm.offlineTracks', JSON.stringify(offlineTracks().filter(t => t.ytId !== id)))
  const url = urls.get(id); if (url) URL.revokeObjectURL(url); urls.delete(id)
  window.dispatchEvent(new Event('stormusic-offline'))
}
