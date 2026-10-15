import { createHash } from 'node:crypto'
import { open, stat, rename } from 'node:fs/promises'
import { audioPath, ensureSpace, library, saveLibrary, type Entry } from './library.ts'
import { readPlan } from './planner.ts'
import { resolveTrack, invalidateResolved, type Resolved } from './resolver.ts'
import { ApiError, mapError } from './runtime.ts'

const MAX_FILE = 150 * 1048576
type Dependencies = { clock: () => number; wait: (ms: number) => Promise<void>; random: () => number; resolve: typeof resolveTrack; fetch: typeof fetch }
const defaults: Dependencies = { clock: Date.now, wait: ms => new Promise<void>(done => setTimeout(done, ms)), random: Math.random, resolve: resolveTrack, fetch: (...args) => fetch(...args) }
let dependencies = defaults
const wait = (ms: number) => dependencies.wait(ms)
let running: Promise<void> | null = null
let deadline = 0

export const isRunning = () => !!running
async function transfer(track: Entry, source: Resolved) {
  let offset = (await stat(audioPath(track.id, true)).catch(() => null))?.size || 0
  const url = new URL(source.url)
  // Persist only a digest of stable media identity, never signed URLs or headers.
  const identity = ['id', 'itag', 'clen', 'lmt'].map(key => url.searchParams.get(key) || '')
  const key = identity.every(Boolean) ? createHash('sha256').update(JSON.stringify(identity)).digest('hex') : ''
  if (!key || track.partialKey !== key || (track.partialExpires || 0) <= dependencies.clock()) offset = 0
  if (offset > 0 && offset === track.total) { await rename(audioPath(track.id, true), audioPath(track.id)); track.status = 'done'; track.bytes = offset; track.percent = 100; track.error = null; return }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), deadline ? Math.max(1, Math.min(180000, deadline - dependencies.clock())) : 180000)
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    const response = await dependencies.fetch(source.url, { signal: controller.signal, headers: { ...source.headers, Range: `bytes=${offset}-` } })
    if ([403, 410, 429].includes(response.status)) { await response.body?.cancel(); invalidateResolved(track.id); throw new ApiError('source_blocked', 'A fonte recusou o download. Nova tentativa será agendada.', 502, true) }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new ApiError('download_failed', 'Não foi possível baixar esta faixa.', 502, true) }
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '')
    const length = Number(response.headers.get('content-length'))
    if (response.status === 200) offset = 0
    const total = response.status === 206 ? Number(range?.[3]) : length
    if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_FILE || (response.status === 206 && (!range || Number(range[1]) !== offset || Number(range[2]) + 1 !== total || (length && length !== total - offset)))) {
      await response.body.cancel(); throw new ApiError('invalid_audio', 'O tamanho do áudio é inválido.', 502, true)
    }
    await ensureSpace(total - offset)
    if (offset && track.total !== total) { await response.body.cancel(); track.partialKey = ''; throw new ApiError('source_changed', 'O formato mudou. O download será reiniciado.', 502, true) }
    track.partialKey = key; track.partialExpires = source.expires
    track.status = 'downloading'; track.total = total; track.bytes = offset; track.duration = source.duration || track.duration
    await saveLibrary()
    file = await open(audioPath(track.id, true), offset ? 'a' : 'w', 0o600)
    let savedAt = 0
    const reader = response.body.getReader()
    while (true) {
      const { done, value: chunk } = await reader.read(); if (done) break
      if (deadline && dependencies.clock() >= deadline) throw new ApiError('window_closed', 'Janela diária encerrada.', 409, true)
      if (track.bytes + chunk.byteLength > total) throw new ApiError('invalid_audio', 'Áudio maior que o tamanho informado.', 502)
      const bytes = Buffer.from(chunk); let written = 0
      while (written < bytes.length) written += (await file.write(bytes, written, bytes.length - written)).bytesWritten
      track.bytes += bytes.length; track.percent = Math.floor(track.bytes / total * 100); track.updatedAt = dependencies.clock()
      if (track.updatedAt - savedAt >= 1000) { savedAt = track.updatedAt; await saveLibrary() }
    }
    if (track.bytes !== total) throw new ApiError('incomplete_audio', 'Download incompleto; será retomado.', 502, true)
    await file.sync(); await file.close(); file = undefined
    await rename(audioPath(track.id, true), audioPath(track.id))
    track.partialKey = ''; track.partialExpires = 0; track.status = 'done'; track.percent = 100; track.error = null
  } finally { clearTimeout(timeout); controller.abort(); await file?.close() }
}
export function runDownloads(until = 0, reset = true, overrides: Partial<Dependencies> = {}): Promise<void> {
  if (running) return running
  dependencies = { ...defaults, ...overrides }
  deadline = until
  running = run(reset).finally(() => { running = null; dependencies = defaults })
  return running
}
async function run(reset: boolean) {
  const state = await library()
  if (reset) { state.pauses = 0; state.blocked = 0; state.pauseUntil = 0; for (const t of state.tracks) if (t.status === 'failed') { t.status = 'queued'; t.attempts = 0 } }
  state.running = true; state.lastRunAt = dependencies.clock(); state.windowEndAt = deadline; state.lastRunStatus = 'em andamento'
  let stopped = false, nextStart = 0
  let gateTail = Promise.resolve()
  const expired = () => stopped || !!deadline && dependencies.clock() >= deadline
  // Serialize starts even with two workers. Both respect the same source circuit breaker.
  const gate = () => {
    const turn = gateTail.then(async () => {
      while (!expired() && Math.max(nextStart, state.pauseUntil) > dependencies.clock()) await wait(Math.min(30000, Math.max(nextStart, state.pauseUntil) - dependencies.clock()))
      if (expired()) throw new ApiError('window_closed', 'Janela diária encerrada.', 409, true)
      nextStart = dependencies.clock() + 15000 + dependencies.random() * 30000
    })
    gateTail = turn.catch(() => {}); return turn
  }
  const worker = async () => {
    while (!expired()) {
      const plan = await readPlan(), wanted = new Set(plan.tracks.map(t => t.id))
      const track = state.tracks.find(t => !t.removed && wanted.has(t.id) && t.status === 'queued')
      if (!track) return
      // Claim synchronously, before the first await, so workers never share a file.
      track.status = 'resolving'; state.currentId = track.id
      while (track.attempts < 3 && !expired()) {
        try {
          await gate()
          track.attempts++; track.status = 'resolving'; track.error = null; track.updatedAt = dependencies.clock(); await saveLibrary()
          await transfer(track, await dependencies.resolve(track.id, 'download'))
          state.blocked = 0; break
        } catch (error) {
          const mapped = mapError(error); track.error = mapped.message; track.status = 'failed'
          if (mapped.code === 'source_blocked') state.blocked++; else if (mapped.code !== 'window_closed') state.blocked = 0
          if (expired() || mapped.code === 'window_closed') break
          if (state.blocked >= 3) {
            state.blocked = 0
            if (state.pauses >= 3) { stopped = true; state.lastRunStatus = 'parcial: bloqueio da fonte'; break }
            state.pauses++; state.pauseUntil = dependencies.clock() + 30 * 60000
            track.attempts = 0; track.status = 'resolving'; await saveLibrary(); continue
          }
          if (!mapped.retryable || track.attempts >= 3) break
          await saveLibrary(); await wait(15000 * track.attempts + dependencies.random() * 15000)
        }
      }
      if ((track as Entry).status !== 'done') track.status = expired() ? 'queued' : 'failed'
      // RN5 requires quiet time after a file finishes, including slow transfers.
      nextStart = Math.max(nextStart, dependencies.clock() + 15000 + dependencies.random() * 30000)
      track.updatedAt = dependencies.clock(); await saveLibrary()
    }
  }
  try {
    await saveLibrary()
    const concurrency = Math.max(1, Math.min(2, Math.floor(Number(process.env.RELAY_DOWNLOAD_CONCURRENCY) || 1)))
    const outcomes = await Promise.allSettled(Array.from({ length: concurrency }, () => worker()))
    if (outcomes.some(result => result.status === 'rejected')) state.lastRunStatus = 'parcial: falha de armazenamento'
    else if (!stopped) {
      const plan = await readPlan()
      state.lastRunStatus = plan.tracks.every(t => state.tracks.some(e => e.id === t.id && e.status === 'done' && !e.removed)) ? 'concluído' : 'parcial'
    }
  } finally {
    state.running = false; state.currentId = null
    for (const t of state.tracks) if (t.status === 'resolving' || t.status === 'downloading') t.status = 'queued'
    await saveLibrary()
  }
}
