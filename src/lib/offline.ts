import { isDownloadRemoved, rememberRemovedDownloads } from './listeningPolicy.ts'
// Offline Supermix: whole audio files stored in Cache Storage (`mix-<at>`).
// Active audio is bounded and reconciled against the authoritative server library.
import { fetchAudioBlob } from './stream'
import { knownDuration, rememberDuration, type Mix } from './taste'
import type { Track } from './data'
import { resetBusy } from './safety'

const KEY = 'ytm.offlineMix'
const PREFIX = 'mix-'
const MAX_DOWNLOADS = 40
let cacheWrites = Promise.resolve()
function mutateCache<T>(work: () => Promise<T>): Promise<T> {
  const next = cacheWrites.catch(() => {}).then(work)
  cacheWrites = next.then(() => {}, () => {})
  return next
}
const copies = new Map<string, AbortController>()
const MIN_FREE = 150 * 1024 * 1024
const path = (ytId: string) => `/offline/${ytId}`

export type OfflineState = { at: number; ids: string[] }
export type Progress = { done: number; total: number; failed: number; at: number }

export const offlineState = (): OfflineState | null => {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
}
export const isOffline = (ytId: string) => !isDownloadRemoved(ytId) && Boolean(offlineState()?.ids.includes(ytId))
export function offlineTracks(): Track[] {
  try { return JSON.parse(localStorage.getItem('ytm.offlineTracks') || '[]') } catch { return [] }
}
const supported = () => typeof caches !== 'undefined'

const urls = new Map<string, string>()
/** blob: URL for a downloaded track, or null. */
export async function offlineUrl(ytId: string): Promise<string | null> {
  if (!supported() || isDownloadRemoved(ytId)) return null
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

  if (mix.tracks.length > MAX_DOWNLOADS) throw new Error('O limite é de 40 músicas baixadas.')
  const wanted = mix.tracks.filter(t => !isDownloadRemoved(t.ytId)).map(t => t.ytId)
  const retained = (offlineState()?.ids || []).filter(id => !wanted.includes(id))
  await reconcileOfflineLibrary([...wanted, ...retained].slice(0, MAX_DOWNLOADS))
  const name = PREFIX + mix.at
  const cache = await caches.open(name)
  const ids = mix.tracks.filter(t => !isDownloadRemoved(t.ytId)).map((t) => t.ytId)
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
          await mutateCache(async () => {
            if (isDownloadRemoved(id)) return
            if (!existing) await cache.put(path(id), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mp4', 'Content-Length': String(blob.size) } }))
            saved = true
          })
          if (isDownloadRemoved(id)) break
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
  await mutateCache(async () => {
    const ids = ok.filter(id => !isDownloadRemoved(id))
    localStorage.setItem('ytm.supermix', JSON.stringify(mix))
    localStorage.setItem('ytm.offlineTracks', JSON.stringify(mix.tracks.filter(t => ids.includes(t.ytId))))
    localStorage.setItem(KEY, JSON.stringify({ at: mix.at, ids } satisfies OfflineState))
  })
  for (const [id, u] of urls) if (!ok.includes(id)) { URL.revokeObjectURL(u); urls.delete(id) }
}

export async function clearOffline() {
  for (const controller of copies.values()) controller.abort()
  await mutateCache(async () => {
    if (supported()) for (const n of await caches.keys()) if (n.startsWith(PREFIX) || n.startsWith('stormusic-backup-')) await caches.delete(n)
    for (const u of urls.values()) URL.revokeObjectURL(u)
    urls.clear()
    localStorage.removeItem(KEY); localStorage.removeItem('ytm.offlineTracks'); localStorage.removeItem('ytm.downloadBackup')
  })
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


/** Remove stale and duplicate audio, including legacy backups, without blacklisting evictions. */
export function reconcileOfflineLibrary(activeIds: string[]) {
  const keep = new Set(activeIds.filter(id => !isDownloadRemoved(id)).slice(0, MAX_DOWNLOADS))
  for (const [id, controller] of copies) if (!keep.has(id)) controller.abort()
  return mutateCache(async () => {
    const present = new Set<string>()
    if (supported()) {
      const names = await caches.keys()
      for (const name of names.filter(n => n.startsWith('stormusic-backup-'))) await caches.delete(name)
      for (const name of names.filter(n => n.startsWith(PREFIX)).sort((a,b) => Number(b === 'mix-library') - Number(a === 'mix-library') || a.localeCompare(b))) {
        const cache = await caches.open(name)
        for (const request of await cache.keys()) {
          const url = typeof request === 'string' ? request : request.url
          const id = new URL(url, 'http://localhost').pathname.split('/').at(-1)!
          if (!keep.has(id) || present.has(id) || isDownloadRemoved(id)) await cache.delete(request)
          else present.add(id)
        }
        if (!(await cache.keys()).length) await caches.delete(name)
      }
    }
    localStorage.removeItem('ytm.downloadBackup')
    const ids = (offlineState()?.ids || []).filter(id => keep.has(id) && (!supported() || present.has(id)))
    localStorage.setItem(KEY, JSON.stringify({ at: offlineState()?.at || Date.now(), ids }))
    localStorage.setItem('ytm.offlineTracks', JSON.stringify(offlineTracks().filter(t => ids.includes(t.ytId))))
    for (const [id, url] of urls) if (!keep.has(id)) { URL.revokeObjectURL(url); urls.delete(id) }
  })
}

/** Copy completed local files; network transfer never locks deletion. */
let copying = false
export async function mirrorLibrary(tracks: { id: string; status: string; bytes: number }[], plan: Track[], idle: () => boolean) {
  if (copying || resetBusy() || !supported()) return
  copying = true
  try {
    const active = tracks.slice(0, MAX_DOWNLOADS)
    await reconcileOfflineLibrary(active.map(t => t.id))
    if (localStorage.getItem('ytm.mirrorPaused') === '1') return
    await navigator.storage?.persist?.().catch(() => false)
    for (const track of plan.slice(0, MAX_DOWNLOADS)) {
      if (!idle() || resetBusy()) break
      const entry = active.find(t => t.id === track.ytId && t.status === 'done')
      if (!entry || isDownloadRemoved(track.ytId) || isOffline(track.ytId)) continue
      const space = await storageInfo()
      if (space.quota && space.quota - space.used < entry.bytes + MIN_FREE) break
      const controller = new AbortController(); copies.set(track.ytId, controller)
      const timer = setTimeout(() => controller.abort(), 30000)
      try {
        const response = await fetch('/api/audio?id=' + track.ytId, { headers: { Range: 'bytes=0-', 'X-Stormusic-Purpose': 'download' }, signal: controller.signal })
        if (!response.ok || response.headers.get('x-stormusic-source') !== 'disk') { await response.body?.cancel(); continue }
        const blob = await response.blob()
        if (blob.size !== entry.bytes || !blob.size) continue
        await mutateCache(async () => {
          if (controller.signal.aborted || localStorage.getItem('ytm.mirrorPaused') === '1' || isDownloadRemoved(track.ytId)) return
          const cache = await caches.open('mix-library')
          await cache.put(path(track.ytId), new Response(blob, { headers: { 'Content-Type': 'audio/mp4', 'Content-Length': String(blob.size) } }))
          const metadata = offlineTracks().filter(t => t.ytId !== track.ytId); metadata.push(track)
          localStorage.setItem('ytm.offlineTracks', JSON.stringify(metadata))
          localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), ids: [...new Set([...(offlineState()?.ids || []), track.ytId])] }))
        })
        window.dispatchEvent(new Event('stormusic-offline'))
        if (!isDownloadRemoved(track.ytId)) void cacheCovers(track.ytId).catch(() => {})
      } catch (error) { if (!controller.signal.aborted) throw error }
      finally { clearTimeout(timer); if (copies.get(track.ytId) === controller) copies.delete(track.ytId) }
    }
  } finally { copying = false }
}

export function removeCachedTrack(id: string) {
  rememberRemovedDownloads([id])
  copies.get(id)?.abort()
  return mutateCache(async () => {
    if (supported()) for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) || name.startsWith('stormusic-backup-')) {
        const cache = await caches.open(name)
        await cache.delete(path(id))
        if (!(await cache.keys()).length) await caches.delete(name)
      }
    }
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), ids: (offlineState()?.ids || []).filter(x => x !== id) }))
    localStorage.setItem('ytm.offlineTracks', JSON.stringify(offlineTracks().filter(t => t.ytId !== id)))
    const url = urls.get(id); if (url) URL.revokeObjectURL(url); urls.delete(id)
    window.dispatchEvent(new Event('stormusic-offline'))
  })
}
