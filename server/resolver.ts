import { AsyncResource } from 'node:async_hooks'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ApiError, extract, videoId } from './runtime.ts'
import { noteCache, noteExtraction } from './metrics.ts'

export type Purpose = 'play' | 'prefetch' | 'download'
export type Resolved = { url: string; headers?: Record<string, string>; duration: number; source: string; mime: string; bitrate: number; expires: number }
type Job = { id: string; priority: number; run: () => Promise<void> }
export function createResolver(options: { workerFactory?: () => ChildProcessWithoutNullStreams; timeoutMs?: number; clock?: () => number } = {}) {
const clock = options.clock || Date.now
const priorities = { play: 0, prefetch: 1, download: 2 }
const cache = new Map<string, Resolved>()
const pending = new Map<string, Promise<Resolved>>()
const queue: Job[] = []
const attempts: number[] = []
let busy = false, serial = 0, recycle = false
let worker: ChildProcessWithoutNullStreams | undefined
let answer: { id: number; done: (value: any) => void; fail: (error: Error) => void } | undefined
let buffer = ''
const failure = () => new ApiError('extractor_outdated', 'Atualize o yt-dlp no painel Motor local.', 503, true)
function boot() {
  if (worker) return worker
  const child = options.workerFactory ? options.workerFactory() : spawn(process.env.RELAY_PYTHON || 'python', [fileURLToPath(new URL('./ytdlp_worker.py', import.meta.url))], {
    windowsHide: true, stdio: 'pipe', env: { ...process.env, STORMUSIC_NODE: process.execPath },
  })
  worker = child; buffer = ''
  const died = () => { if (worker !== child) return; worker = undefined; const a = answer; answer = undefined; a?.fail(failure()) }
  child.on('error', died); child.on('exit', died)
  child.stdin.on('error', died)
  child.stderr.on('data', () => {})
  child.stdout.on('data', chunk => {
    buffer += chunk.toString()
    if (buffer.length > 256 * 1024) { died(); child.kill(); return }
    let end: number
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
      try { const value = JSON.parse(line); if (value.id === answer?.id) { const a = answer; answer = undefined; a?.done(value) } }
      catch { died(); child.kill() }
    }
  })
  return child
}
function request(id: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = boot(), requestId = ++serial
    const timer = setTimeout(() => { answer = undefined; if (worker === child) worker = undefined; child.kill(); reject(new ApiError('extract_timeout', 'Resolução demorou demais. Tente novamente.', 504, true)) }, options.timeoutMs ?? 20000)
    answer = { id: requestId, done: value => { clearTimeout(timer); value.error ? reject(new ApiError(value.error, value.error === 'source_blocked' ? 'O YouTube recusou a extração. O lote fará uma pausa.' : 'Não foi possível resolver esta faixa.', 502, true)) : resolve(value.result) }, fail: error => { clearTimeout(timer); reject(error) } }
    child.stdin.write(JSON.stringify({ id: requestId, video: id }) + '\n')
  })
}
async function drain() {
  if (busy) return
  busy = true
  try { while (queue.length) { queue.sort((a, b) => a.priority - b.priority); await queue.shift()!.run() } }
  finally { busy = false }
}
function recycleWorker() { const child = worker; worker = undefined; recycle = false; child?.kill() }
function resetResolver() { cache.clear(); recycle = true; if (!busy) recycleWorker() }
function invalidateResolved(id: string) { cache.delete(id) }
function resolveTrack(id: string, purpose: Purpose = 'play'): Promise<Resolved> {
  if (!videoId.test(id)) return Promise.reject(new ApiError('invalid_input', 'ID inválido.', 400))
  const hit = cache.get(id)
  if (hit && hit.expires > clock()) { cache.delete(id); cache.set(id, hit); noteCache('hit'); return Promise.resolve(hit) }
  if (pending.has(id)) { const job = queue.find(j => j.id === id); if (job) job.priority = Math.min(job.priority, priorities[purpose]); noteCache('shared'); return pending.get(id)! }
  if (queue.length >= 120) return Promise.reject(new ApiError('rate_limited', 'Fila cheia. Tente mais tarde.', 429, true))
  noteCache('miss')
  const queued = performance.now()
  const promise = new Promise<Resolved>((resolve, reject) => {
    queue.push({ id, priority: priorities[purpose], run: AsyncResource.bind(async () => {
      const start = performance.now(); let code: string | null = null
      try {
        const now = clock(); while (attempts.length && attempts[0] < now - 3600000) attempts.shift()
        if (attempts.length >= (Number(process.env.RELAY_MAX_RESOLVES_PER_HOUR) || 120)) throw new ApiError('rate_limited', 'Limite de extrações atingido. Tente mais tarde.', 429, true)
        attempts.push(now)
        const j = process.env.RELAY_RESOLVER === 'spawn'
          ? await extract(['-j', '--no-playlist', '-f', 'bestaudio[ext=m4a]', '--', 'https://www.youtube.com/watch?v=' + id]) : await request(id)
        if (j.is_live || ['is_live', 'is_upcoming'].includes(j.live_status)) throw new ApiError('live_not_supported', 'Transmissões ao vivo não são suportadas.')
        const url = new URL(j.url)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw failure()
        const expires = Math.min(clock() + 5 * 3600000, (Number(url.searchParams.get('expire')) * 1000 || Infinity) - 60000)
        const value: Resolved = { url: url.href, headers: j.http_headers, duration: Number(j.duration) || 0, source: 'yt-dlp local', mime: 'audio/mp4', bitrate: (j.abr || 0) * 1000, expires }
        cache.delete(id); cache.set(id, value)
        if (cache.size > 300) cache.delete(cache.keys().next().value!)
        resolve(value)
      } catch (error) { code = error instanceof ApiError ? error.code : 'extractor_outdated'; reject(error instanceof ApiError ? error : failure()) }
      finally { if (process.env.RELAY_RESOLVER !== 'spawn') noteExtraction(start - queued, performance.now() - start, code); pending.delete(id); if (recycle) recycleWorker() }
    }) })
  })
  pending.set(id, promise); void drain(); return promise
}

return { resolveTrack, invalidateResolved, resetResolver }
}
export const { resolveTrack, invalidateResolved, resetResolver } = createResolver()
