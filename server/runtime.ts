import { execFile } from 'node:child_process'
import { noteExtraction } from './metrics.ts'

export const videoId = /^[A-Za-z0-9_-]{11}$/
export class ApiError extends Error {
  code: string
  status: number
  retryable: boolean
  constructor(code: string, message: string, status = 502, retryable = false) {
    super(message); this.code = code; this.status = status; this.retryable = retryable
  }
}
export function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  const s = String(error).toLowerCase()
  if (/not a bot|403|429|blocked|try again later|po token/.test(s)) return new ApiError('source_blocked', 'O YouTube recusou este IP; tente em outra rede', 502, true)
  if (/age.restrict|confirm your age|sign in to confirm|login required/.test(s)) return new ApiError('video_age_restricted', 'Esta faixa tem restrição de idade.')
  if (/is_live|is_upcoming|live event|premieres in/.test(s)) return new ApiError('live_not_supported', 'Transmissões ao vivo não são suportadas.')
  if (/private|unavailable|removed|not available/.test(s)) return new ApiError('video_private', 'Esta faixa está privada ou indisponível.')
  if (/enoent|extract|signature|challenge|ejs/.test(s)) return new ApiError('extractor_outdated', 'Atualize o yt-dlp no painel Motor local.', 503, true)
  return new ApiError('upstream_failed', 'Não foi possível obter o áudio. Tente novamente.', 502, true)
}
export function command(file: string, args: string[], timeout = 45000, cwd?: string): Promise<string> {
  // Also accept Node executable fixtures for cross-platform integration tests.
  if (file.endsWith('.mjs')) { args = [file, ...args]; file = process.execPath }
  return new Promise((resolve, reject) => execFile(file, args, { timeout, maxBuffer: 16 << 20, cwd, windowsHide: true }, (err, out) => err ? reject(err) : resolve(out.trim())))
}
export const ytdlpPath = () => process.env.YTDLP_PATH || 'yt-dlp'
const concurrency = Math.max(1, Number(process.env.RELAY_CONCURRENCY) || 2)
let active = 0
const waiting: (() => void)[] = []
const attempts: number[] = []
export async function extract(args: string[]) {
  const queuedAt = performance.now()
  const now = Date.now()
  while (attempts.length && attempts[0] < now - 3600000) attempts.shift()
  if (attempts.length >= (Number(process.env.RELAY_MAX_RESOLVES_PER_HOUR) || 120)) throw new ApiError('rate_limited', 'Limite de extrações atingido. Tente mais tarde.', 429, true)
  attempts.push(now)
  if (active >= concurrency) await new Promise<void>((done) => waiting.push(done))
  else active++
  const startedAt = performance.now()
  let measuredError: string | null = null
  try {
    return JSON.parse(await command(ytdlpPath(), ['--ignore-config', '--no-warnings', '--js-runtimes', 'node', ...args]))
  } catch (error) {
    const mapped = mapError(error)
    measuredError = (error as { killed?: boolean })?.killed ? 'extract_timeout' : mapped.code
    throw mapped
  } finally {
    noteExtraction(startedAt - queuedAt, performance.now() - startedAt, measuredError)
    const next = waiting.shift(); if (next) next(); else active--
  }
}
export class Lru<T> {
  entries = new Map<string, { value: T; expires: number }>()
  get(key: string): T | undefined {
    const hit = this.entries.get(key)
    if (!hit) return
    this.entries.delete(key)
    if (hit.expires <= Date.now()) return
    this.entries.set(key, hit); return hit.value
  }
  set(key: string, value: T, expires: number) {
    this.entries.delete(key); this.entries.set(key, { value, expires })
    if (this.entries.size > 200) this.entries.delete(this.entries.keys().next().value!)
  }
  delete(key: string) { this.entries.delete(key) }
}
