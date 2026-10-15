import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

type Purpose = 'play' | 'prefetch' | 'download'
type Sample = {
  request_id: string; at: string; id: string; type: Purpose; phase: 'resolve' | 'audio'
  stage: 'started' | 'finished'; status: number | null; range: boolean
  resolve_ms: number | null; first_byte_ms: number | null; download_ms: number | null
  queue_ms: number | null; extract_ms: number | null; extract_count: number
  cache: 'hit' | 'miss' | 'shared' | null; renewed: boolean; bytes: number
  error: string | null; extract_error: string | null
}
const context = new AsyncLocalStorage<Sample>()
let writes = Promise.resolve()
let warned = false
const ms = (value: number) => Math.round(value * 100) / 100
function append(sample: Sample) {
  const directory = process.env.RELAY_STATE_DIR || resolve(homedir(), '.stormusic')
  // Snapshot now: the in-memory sample continues changing while audio is streamed.
  const line = JSON.stringify(sample) + '\n'
  writes = writes.then(async () => {
    await mkdir(directory, { recursive: true })
    await appendFile(resolve(directory, 'metrics.jsonl'), line, { mode: 0o600 })
  }).catch(() => {
    if (!warned) console.warn('Stormusic: não foi possível gravar metrics.jsonl; reprodução mantida.')
    warned = true
  })
}
export const flushMetrics = () => writes
export function noteCache(cache: Sample['cache']) {
  const sample = context.getStore(); if (sample) sample.cache = cache
}
export function noteExtraction(queueMs: number, extractMs: number, error: string | null) {
  const sample = context.getStore(); if (!sample) return
  sample.queue_ms = ms((sample.queue_ms || 0) + queueMs)
  sample.extract_ms = ms((sample.extract_ms || 0) + extractMs)
  sample.extract_count++
  sample.extract_error = error
}

/** Diagnostic only: no URLs, request headers, extractor output or error messages are saved. */
export function requestMetric(req: IncomingMessage, res: ServerResponse, id: string, phase: Sample['phase'], clock = () => performance.now()) {
  const started = clock()
  const requested = req.headers['x-stormusic-purpose']
  const type: Purpose = requested === 'download' || requested === 'prefetch' ? requested : 'play'
  const sample: Sample = {
    request_id: randomUUID(), at: new Date().toISOString(), id, type, phase,
    stage: 'started', status: null, range: !!req.headers.range,
    resolve_ms: null, first_byte_ms: null, download_ms: null,
    queue_ms: null, extract_ms: null, extract_count: 0, cache: null,
    renewed: false, bytes: 0, error: null, extract_error: null,
  }
  append(sample)
  let finished = false
  const finish = (closed = false) => {
    if (finished) return
    finished = true
    sample.stage = 'finished'; sample.status = res.headersSent ? res.statusCode : null
    if (phase === 'audio') sample.download_ms = ms(clock() - started)
    if (closed) sample.error ??= 'client_closed'
    append(sample)
  }
  res.once('finish', () => finish())
  res.once('close', () => finish(!res.writableFinished))
  return {
    async resolve<T>(operation: () => Promise<T>): Promise<T> {
      const start = clock()
      try { return await context.run(sample, operation) }
      finally { sample.resolve_ms = ms((sample.resolve_ms || 0) + clock() - start) }
    },
    chunk(bytes: number) {
      sample.first_byte_ms ??= ms(clock() - started)
      sample.bytes += bytes
    },
    error(code: string) { sample.error ??= code },
    renewed() { sample.renewed = true },
  }
}
