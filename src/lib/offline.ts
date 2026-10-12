// Offline Supermix: whole audio files stored in Cache Storage (`mix-<at>`).
// Only the most recent mix is kept; older caches are dropped once the new one finishes.
import { fetchAudioBlob } from './stream'
import type { Mix } from './taste'

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
  if (running) return running
  running = run(mix, onProgress).finally(() => { running = null })
  return running
}
export const downloading = () => running !== null

async function run(mix: Mix, onProgress: (p: Progress) => void) {
  if (!supported()) throw new Error('Cache Storage indisponível neste navegador')
  if (offlineState()?.at === mix.at) return
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
      if (await cache.match(path(id))) { ok.push(id); report(); continue }
      let saved = false
      for (let attempt = 0; attempt < 3 && !saved; attempt++) {
        try {
          const blob = await fetchAudioBlob(id)
          await cache.put(path(id), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mp4', 'Content-Length': String(blob.size) } }))
          saved = true
        } catch { /* retry */ }
      }
      if (saved) ok.push(id); else failed++
      report()
    }
  }
  await Promise.all([worker(), worker()]) // concurrency 2

  if (!ok.length) { await caches.delete(name); throw new Error('Nenhuma faixa pôde ser baixada') }
  localStorage.setItem(KEY, JSON.stringify({ at: mix.at, ids: ok } satisfies OfflineState))
  for (const n of await caches.keys()) if (n.startsWith(PREFIX) && n !== name) await caches.delete(n)
  for (const [id, u] of urls) if (!ok.includes(id)) { URL.revokeObjectURL(u); urls.delete(id) }
}

export async function clearOffline() {
  if (supported()) for (const n of await caches.keys()) if (n.startsWith(PREFIX)) await caches.delete(n)
  for (const u of urls.values()) URL.revokeObjectURL(u)
  urls.clear()
  localStorage.removeItem(KEY)
}
