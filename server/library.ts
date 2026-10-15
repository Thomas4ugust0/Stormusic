import { mkdir, readFile, rename, open, stat, statfs } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, videoId } from './runtime.ts'

export type Track = { id: string; title: string; artist: string; album?: string; duration: number }
export type Entry = Track & { status: 'queued' | 'resolving' | 'downloading' | 'done' | 'failed'; bytes: number; total: number; percent: number; attempts: number; error: string | null; updatedAt: number; addedAt: number; removed?: boolean; outsideSince?: number; cleanupEligible?: boolean; partialKey?: string; partialExpires?: number }
export type State = { version: 1; tracks: Entry[]; nextRunAt: number; windowEndAt: number; lastRunAt: number; lastRunStatus: string; running: boolean; currentId: string | null; pauseUntil: number; pauses: number; blocked: number }
export const directory = () => process.env.RELAY_STATE_DIR || resolve(homedir(), '.stormusic')
export const audioPath = (id: string, partial = false) => {
  if (!videoId.test(id)) throw new ApiError('invalid_input', 'ID inválido.', 400)
  return resolve(directory(), 'audio', id + '.m4a' + (partial ? '.part' : ''))
}
export async function atomic(name: 'library.json' | 'plan.json', value: unknown) {
  await mkdir(directory(), { recursive: true })
  const temp = resolve(directory(), name + '.' + randomUUID() + '.tmp')
  const file = await open(temp, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(value)); await file.sync() } finally { await file.close() }
  await rename(temp, resolve(directory(), name))
}
export async function readState<T>(name: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(resolve(directory(), name), 'utf8')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw new ApiError('state_unreadable', 'Estado local ilegível. Preserve a pasta .stormusic para recuperação.', 503) }
}
let loaded: Promise<State> | undefined
let writes = Promise.resolve()
export function library(): Promise<State> {
  return loaded ??= (async () => {
    await mkdir(resolve(directory(), 'audio'), { recursive: true })
    const state = await readState<State>('library.json', { version: 1, tracks: [], nextRunAt: 0, windowEndAt: 0, lastRunAt: 0, lastRunStatus: 'aguardando', running: false, currentId: null, pauseUntil: 0, pauses: 0, blocked: 0 })
    if (state.version !== 1 || !Array.isArray(state.tracks) || state.tracks.some(t => !videoId.test(t.id))) throw new ApiError('state_unreadable', 'Biblioteca incompatível. Preserve os dados.', 503)
    state.running = false; state.currentId = null
    for (const track of state.tracks) {
      if (track.status === 'downloading' || track.status === 'resolving') { track.status = 'queued'; track.attempts = 0 }
      if (track.status === 'done' && !(await stat(audioPath(track.id)).catch(() => null))?.isFile()) { track.status = 'queued'; track.bytes = 0; track.percent = 0 }
    }
    return state
  })()
}
export async function saveLibrary() {
  const snapshot = structuredClone(await library())
  const operation = writes.catch(() => {}).then(() => atomic('library.json', snapshot))
  writes = operation; await operation
}
export async function ensureSpace(extra: number) {
  const info = await statfs(directory())
  const limit = Math.max(256, Number(process.env.RELAY_LIBRARY_MB) || 2048) * 1048576
  const used = (await library()).tracks.reduce((n, t) => n + t.bytes, 0)
  if (info.bavail * info.bsize < extra + 150 * 1048576 || used + extra > limit) throw new ApiError('storage_full', 'Pouco espaço para baixar. Libere espaço no aparelho.', 507)
}
let transferSample = { id: '', bytes: 0, at: 0, rate: 0 }
export async function snapshot() {
  const state = await library(), tracks = state.tracks.filter(t => !t.removed), done = tracks.filter(t => t.status === 'done')
  for (const track of tracks) track.cleanupEligible = state.lastRunStatus === 'concluído' && !!track.outsideSince && Date.now() - track.outsideSince >= 86400000
  const current = tracks.find(t => t.id === state.currentId), now = Date.now()
  if (current && current.status === 'downloading') {
    if (transferSample.id !== current.id) transferSample = { id: current.id, bytes: current.bytes, at: now, rate: 0 }
    else if (now - transferSample.at >= 1000 && current.bytes > transferSample.bytes) {
      transferSample.rate = (current.bytes - transferSample.bytes) / ((now - transferSample.at) / 1000)
      transferSample.at = now; transferSample.bytes = current.bytes
    }
  }
  const remaining = tracks.filter(t => !['done', 'failed'].includes(t.status))
  const averageSize = done.length ? done.reduce((n, t) => n + t.bytes, 0) / done.length : current?.total || 0
  const eta = state.running && transferSample.rate > 0 && averageSize > 0
    ? Math.ceil(remaining.reduce((n, t) => n + Math.max(0, (t.total || averageSize) - t.bytes), 0) / transferSample.rate + Math.max(0, remaining.length - 1) * 30 + Math.max(0, state.pauseUntil - now) / 1000) : null
  return { tracks, summary: { done: done.length, total: tracks.length, failed: tracks.filter(t => t.status === 'failed').length,
    bytes: done.reduce((n, t) => n + t.bytes, 0), minutes: done.reduce((n, t) => n + t.duration, 0) / 60,
    etaSec: eta, running: state.running, currentId: state.currentId, nextRunAt: state.nextRunAt, windowEndAt: state.windowEndAt,
    lastRunAt: state.lastRunAt, lastRunStatus: state.lastRunStatus, pauseUntil: state.pauseUntil } }
}
export async function removeTrack(id: string) {
  const state = await library(), track = state.tracks.find(t => t.id === id)
  if (!track) throw new ApiError('not_found', 'Faixa não encontrada.', 404)
  if (state.running) throw new ApiError('busy', 'Aguarde o lote terminar antes de remover.', 409)
  // Move to a recoverable backup before changing the library. Never unlink user audio.
  const backup = resolve(directory(), 'backups', Date.now() + '-' + randomUUID())
  await mkdir(backup, { recursive: true })
  const meta = await open(resolve(backup, 'track.json'), 'wx', 0o600)
  try { await meta.writeFile(JSON.stringify(track)); await meta.sync() } finally { await meta.close() }
  for (const part of [false, true]) {
    try { await rename(audioPath(id, part), resolve(backup, id + '.m4a' + (part ? '.part' : ''))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  track.removed = true; track.status = 'queued'; track.bytes = 0; track.percent = 0
  await saveLibrary()
}
export async function serveDisk(id: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const track = (await library()).tracks.find(t => t.id === id && t.status === 'done' && !t.removed)
  if (!track) return false
  const info = await stat(audioPath(id)).catch(() => null)
  if (!info?.isFile()) return false
  let start = 0, end = info.size - 1
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
    if (!match || (!match[1] && !match[2])) throw new ApiError('invalid_range', 'Intervalo inválido.', 416)
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]))
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) { res.setHeader('content-range', `bytes */${info.size}`); res.statusCode = 416; res.end(); return true }
    res.statusCode = 206; res.setHeader('content-range', `bytes ${start}-${end}/${info.size}`)
  }
  res.setHeader('content-type', 'audio/mp4'); res.setHeader('content-length', end - start + 1)
  res.setHeader('accept-ranges', 'bytes'); res.setHeader('x-stormusic-source', 'disk'); res.setHeader('cache-control', 'no-store')
  if (req.method === 'HEAD') res.end()
  else { const stream = createReadStream(audioPath(id), { start, end }); stream.on('error', () => res.destroy()); res.once('close', () => stream.destroy()); stream.pipe(res) }
  return true
}
