import { clearOffline, downloading } from './offline'
import { reloadTaste } from './taste'

const WEEK = 7 * 86400_000
const KEYS = ['ytm.profile', 'ytm.fb', 'ytm.taste'] as const
type Values = Record<string, string | null>
type Backup = { version: 1; at: number; values: Values }
type AudioBackup = Backup & { caches: { from: string; to: string }[] }
const snapshot = (keys: readonly string[]): Values => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]))
const empty: Values = { 'ytm.fb': '{"liked":[],"disliked":[],"played":[]}', 'ytm.taste': '{"ev":[],"meta":{}}', 'ytm.offlineTracks': '[]' }
const apply = (values: Values) => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value === null || value === 'null' ? empty[key] ?? 'null' : value) }

function readBackup<T extends Backup>(key: string, keys: readonly string[], now: number): T | null {
  try {
    const b = JSON.parse(localStorage.getItem(key) || 'null')
    if (!b || b.version !== 1 || !Number.isFinite(b.at) || b.at > now || now - b.at >= WEEK || !b.values) return null
    if (Object.keys(b.values).length !== keys.length || keys.some(k => !(k in b.values) || (b.values[k] !== null && typeof b.values[k] !== 'string'))) return null
    for (const [name, value] of Object.entries(b.values)) if (value !== null) {
      const parsed = JSON.parse(value as string)
      if (parsed === null) continue
      const lists = name === 'ytm.profile' ? ['genres', 'subs', 'artists'] : name === 'ytm.fb' ? ['liked', 'disliked', 'played'] : []
      if (lists.some(k => !Array.isArray(parsed[k]) || parsed[k].some((v: unknown) => typeof v !== 'string'))) return null
      if (name === 'ytm.taste' && (!Array.isArray(parsed.ev) || !parsed.meta || typeof parsed.meta !== 'object')) return null
      if (name === 'ytm.offlineTracks' && !Array.isArray(parsed)) return null
      if (name === 'ytm.offlineMix' && (!Number.isFinite(parsed.at) || !Array.isArray(parsed.ids))) return null
    }
    return b
  } catch { return null }
}
export const hasBackup = (now = Date.now()) => !!readBackup('ytm.backup', KEYS, now)
export function backupTaste(now = Date.now()) {
  const backup: Backup = { version: 1, at: now, values: snapshot(KEYS) }
  localStorage.setItem('ytm.backup', JSON.stringify(backup)) // If quota fails, nothing is reset.
}
export function restoreTaste(now = Date.now()) {
  const b = readBackup('ytm.backup', KEYS, now)
  if (!b) throw new Error('Backup ausente, inválido ou com mais de sete dias.')
  const current = snapshot(KEYS)
  try { apply(b.values); reloadTaste() }
  catch (error) { apply(current); reloadTaste(); throw error }
}

const AUDIO_KEYS = ['ytm.offlineMix', 'ytm.offlineTracks']
function audioBackup(now: number) {
  const b = readBackup<AudioBackup>('ytm.downloadBackup', AUDIO_KEYS, now)
  if (!b || !Array.isArray(b.caches) || b.caches.some(c => !c || typeof c.from !== 'string' || !c.from.startsWith('mix-') || !/^stormusic-backup-[a-zA-Z0-9-]+$/.test(c.to))) return null
  return b
}
export const hasDownloadBackup = (now = Date.now()) => !!audioBackup(now)
export async function downloadSummary() {
  let bytes = 0; const ids = new Set<string>()
  if (typeof caches !== 'undefined') for (const name of await caches.keys()) if (name.startsWith('mix-')) {
    const cache = await caches.open(name)
    for (const request of await cache.keys()) {
      const response = await cache.match(request)
      ids.add(typeof request === 'string' ? request : request.url)
      if (response) bytes += Number(response.headers.get('content-length')) || (await response.blob()).size
    }
  }
  return { count: ids.size, bytes }
}
let busy = false
export const resetBusy = () => busy
async function exclusive<T>(work: () => Promise<T>) {
  if (busy || downloading()) throw new Error('Aguarde o download ou a restauração terminar.')
  busy = true
  try { return await work() } finally { busy = false }
}
export async function restoreDownloads(now = Date.now()) {
  return exclusive(async () => {
    const b = audioBackup(now)
    if (!b) throw new Error('Backup de downloads ausente ou expirado.')
    const names = await caches.keys()
    if (b.caches.some(c => !names.includes(c.to))) throw new Error('O navegador removeu parte do backup. Restauração cancelada.')
    for (const c of b.caches) {
      const source = await caches.open(c.to); const target = await caches.open(c.from)
      for (const request of await source.keys()) {
        const response = await source.match(request)
        if (!response) throw new Error('Backup incompleto.')
        await target.put(request, response)
      }
    }
    apply(b.values)
  })
}

/** Only the confirmed risk-zone actions call this function. Never clear unrelated keys. */
export async function safeReset(kind: 'taste' | 'downloads', confirmed: boolean, now = Date.now()) {
  if (!confirmed) throw new Error('Confirme a operação antes de continuar.')
  if (kind !== 'taste' && kind !== 'downloads') throw new Error('Operação inválida.')
  return exclusive(async () => {
    backupTaste(now)
    if (kind === 'taste') {
      const current = snapshot(KEYS)
      try {
        localStorage.setItem('ytm.fb', JSON.stringify({ liked: [], disliked: [], played: [] }))
        localStorage.setItem('ytm.taste', JSON.stringify({ ev: [], meta: {} }))
        reloadTaste()
      } catch (error) { apply(current); reloadTaste(); throw error }
      return
    }
    if (typeof caches === 'undefined') throw new Error('Cache Storage indisponível.')
    const backup: AudioBackup = { version: 1, at: now, values: snapshot(AUDIO_KEYS), caches: [] }
    for (const from of await caches.keys()) if (from.startsWith('mix-')) {
      const to = 'stormusic-backup-' + crypto.randomUUID()
      const source = await caches.open(from); const target = await caches.open(to)
      for (const request of await source.keys()) {
        const response = await source.match(request)
        if (!response) throw new Error('Não foi possível copiar todos os downloads; limpeza cancelada.')
        await target.put(request, response)
      }
      backup.caches.push({ from, to })
    }
    localStorage.setItem('ytm.downloadBackup', JSON.stringify(backup))
    localStorage.setItem('ytm.mirrorPaused', '1')
    await clearOffline()
    localStorage.removeItem('ytm.offlineMix')
    localStorage.removeItem('ytm.offlineTracks')
  })
}
