// Server-side stream relay. Runs inside the Vite dev/preview server (Node), so it
// is not subject to browser CORS. It:
//  1. discovers healthy Piped / Invidious instances dynamically,
//  2. races them in parallel to resolve the full-length audio-only stream,
//  3. pipes the audio bytes back through /api/audio with HTTP Range support
//     (seeking + full duration) so IP-locked / referer-checked URLs still play.
import type { Plugin, Connect } from 'vite'
// Resolution order: local yt-dlp -> public Piped/Invidious (probed).
import { Readable } from 'node:stream'
import { execFile } from 'node:child_process'

type Resolved = { headers?: Record<string, string>; url: string; duration: number; source: string; mime: string; bitrate: number; expires: number }

const STATIC_PIPED = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.private.coffee', 'https://pipedapi.r4fo.com', 'https://pipedapi.leptons.xyz']
const STATIC_INV = ['https://inv.nadeko.net', 'https://invidious.nerdvpn.de', 'https://yewtu.be', 'https://invidious.f5.si', 'https://iv.melmac.space']
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36'

const cache = new Map<string, Resolved>()
const allowedHosts = new Set<string>()
const health = new Map<string, number>() // instance -> failures
let pool: { piped: string[]; inv: string[]; at: number } = { piped: STATIC_PIPED, inv: STATIC_INV, at: 0 }

async function getJson(url: string, ms = 6000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms)
  try { const r = await fetch(url, { signal: c.signal, headers: { 'user-agent': UA, accept: 'application/json' } }); if (!r.ok) throw new Error(`${r.status}`); return await r.json() } finally { clearTimeout(t) }
}

async function refreshPool() {
  if (Date.now() - pool.at < 30 * 60_000) return
  pool.at = Date.now()
  const [p, i] = await Promise.allSettled([
    getJson('https://piped-instances.kavin.rocks/'),
    getJson('https://api.invidious.io/instances.json?sort_by=health'),
  ])
  const piped = p.status === 'fulfilled' ? (p.value as { api_url: string; uptime_24h?: number }[]).filter((x) => (x.uptime_24h ?? 100) > 80).map((x) => x.api_url) : []
  const inv = i.status === 'fulfilled' ? (i.value as [string, { api?: boolean; type: string; uri: string }][]).filter(([, v]) => v.api && v.type === 'https').map(([, v]) => v.uri) : []
  pool = { piped: [...new Set([...STATIC_PIPED, ...piped])], inv: [...new Set([...STATIC_INV, ...inv])], at: pool.at }
}

const ranked = (list: string[]) => [...list].sort((a, b) => (health.get(a) ?? 0) - (health.get(b) ?? 0)).slice(0, 10)
const fail = (b: string) => { health.set(b, (health.get(b) ?? 0) + 1); throw new Error(b) }

async function viaPiped(base: string, id: string): Promise<Resolved> {
  try {
    const j = await getJson(`${base}/streams/${id}`)
    const s = (j.audioStreams as { url: string; bitrate: number; mimeType: string }[] | undefined)?.filter((a) => a.mimeType?.startsWith('audio'))
      .sort((a, b) => (b.mimeType.includes('mp4') ? 1 : 0) - (a.mimeType.includes('mp4') ? 1 : 0) || b.bitrate - a.bitrate)[0] // prefer m4a (Safari)
    if (!s) throw 0
    return { url: s.url, duration: j.duration, mime: s.mimeType, bitrate: s.bitrate, source: `Piped · ${new URL(base).host}`, expires: Date.now() + 4 * 3600_000 }
  } catch { return fail(base) }
}

async function viaInvidious(base: string, id: string): Promise<Resolved> {
  try {
    const j = await getJson(`${base}/api/v1/videos/${id}?local=true&fields=adaptiveFormats,lengthSeconds`)
    const s = (j.adaptiveFormats as { url: string; type: string; bitrate: string }[] | undefined)?.filter((f) => f.type.startsWith('audio'))
      .sort((a, b) => (b.type.includes('mp4') ? 1 : 0) - (a.type.includes('mp4') ? 1 : 0) || +b.bitrate - +a.bitrate)[0]
    if (!s) throw 0
    const url = s.url.startsWith('http') ? s.url : base + s.url // local=true -> proxied by instance
    return { url, duration: j.lengthSeconds, mime: s.type.split(';')[0], bitrate: +s.bitrate, source: `Invidious · ${new URL(base).host}`, expires: Date.now() + 4 * 3600_000 }
  } catch { return fail(base) }
}

// Instances may answer the API but gate the media behind a bot challenge (HTML).
// Only accept a candidate whose first bytes are really audio.
async function probe(r: Resolved, base: string): Promise<Resolved> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 6000)
  try {
    const up = await fetch(r.url, { signal: c.signal, headers: { 'user-agent': UA, range: 'bytes=0-1' } })
    const ct = up.headers.get('content-type') ?? ''
    c.abort()
    if (up.status < 400 && /audio|video|octet-stream/.test(ct)) return r
  } catch { /* fallthrough */ } finally { clearTimeout(t) }
  health.set(base, (health.get(base) ?? 0) + 5)
  throw new Error('probe ' + base)
}

// Tier 1: local yt-dlp (most reliable when the server has a residential IP).
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp'
let ytdlpMissing = false
function viaYtDlp(id: string): Promise<Resolved> {
  if (ytdlpMissing) return Promise.reject(new Error('no yt-dlp'))
  return new Promise((ok, ko) => execFile(YTDLP, ['-j', '--no-playlist', '--no-warnings', '--js-runtimes', 'node', '-f', 'bestaudio[ext=m4a]/bestaudio', `https://www.youtube.com/watch?v=${id}`], { timeout: 45000, maxBuffer: 64 << 20 }, (err, out) => {
    if (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') ytdlpMissing = true; return ko(err) }
    try {
      const j = JSON.parse(out)
      if (!j.url) return ko(new Error('no url'))
      const exp = Number(new URL(j.url).searchParams.get('expire')) * 1000 || Date.now() + 3600_000
      ok({ url: j.url, headers: j.http_headers, duration: j.duration, mime: `audio/${j.ext}`, bitrate: (j.abr ?? 0) * 1000, source: 'yt-dlp local', expires: exp - 60_000 })
    } catch (e) { ko(e) }
  }))
}

const firstOk = <T,>(ps: Promise<T>[]) => new Promise<T>((ok, ko) => { let n = ps.length; if (!n) ko(new Error('none')); ps.forEach((p) => p.then(ok, () => --n || ko(new Error('all failed')))) })

async function resolve(id: string): Promise<Resolved> {
  const hit = cache.get(id); if (hit && hit.expires > Date.now()) return hit
  const local = await viaYtDlp(id).catch(() => null)
  if (local) { allowedHosts.add(new URL(local.url).host); cache.set(id, local); return local }
  await refreshPool()
  // Tier 2: race every public instance in parallel; first verified stream wins.
  const r = await firstOk([...ranked(pool.piped).map((b) => viaPiped(b, id).then((r) => probe(r, b))), ...ranked(pool.inv).map((b) => viaInvidious(b, id).then((r) => probe(r, b)))])
  allowedHosts.add(new URL(r.url).host)
  cache.set(id, r); return r
}

const send = (res: Parameters<Connect.NextHandleFunction>[1], code: number, body: unknown) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)) }

export const handler: Connect.NextHandleFunction = async (req, res, next) => {
  // CORS so a phone-hosted / home-hosted relay can serve the deployed PWA.
  res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-headers', 'range'); res.setHeader('access-control-expose-headers', 'content-range, content-length, accept-ranges')
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end() }
  const u = new URL(req.url ?? '/', 'http://x')
  const m = u.pathname.match(/\/api\/resolve\/([\w-]{11})$/)
  if (m) {
    try { const r = await resolve(m[1]); return send(res, 200, { url: `/api/audio?id=${m[1]}`, duration: r.duration, source: r.source, mime: r.mime, bitrate: r.bitrate }) }
    catch { return send(res, 502, { error: 'no instance could resolve this track' }) }
  }
  if (u.pathname.endsWith('/api/audio')) {
    const id = u.searchParams.get('id') ?? ''
    const r = cache.get(id)
    if (!r || !allowedHosts.has(new URL(r.url).host)) return send(res, 404, { error: 'resolve first' }) // not an open proxy
    const pipe = async (retry: boolean): Promise<void> => {
      const up = await fetch(r.url, { headers: { 'user-agent': UA, ...r.headers, ...(req.headers.range ? { range: req.headers.range } : {}) } })
      if ((up.status === 403 || up.status === 410) && retry) { cache.delete(id); await resolve(id).catch(() => {}); return pipe(false) } // expired URL
      res.statusCode = up.status
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(h); if (v) res.setHeader(h, v) }
      if (!up.headers.get('accept-ranges')) res.setHeader('accept-ranges', 'bytes')
      if (!up.body) return void res.end()
      const s = Readable.fromWeb(up.body as never); req.on('close', () => s.destroy()); s.pipe(res)
    }
    return pipe(true).catch(() => send(res, 502, { error: 'upstream failed' }))
  }
  next()
}

export default function streamRelay(): Plugin {
  return { name: 'stream-relay', configureServer: (s) => void s.middlewares.use(handler), configurePreviewServer: (s) => void s.middlewares.use(handler) }
}
