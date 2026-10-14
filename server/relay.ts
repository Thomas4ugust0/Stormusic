// Same-origin yt-dlp API for the phone PWA, also mounted in Vite for development.
// Public instances are strictly opt-in via RELAY_PUBLIC_FALLBACK=1.
import type { Plugin, Connect } from 'vite'
// Resolution order: local yt-dlp -> public Piped/Invidious (probed).
import { Readable } from 'node:stream'
import { ApiError, extract, Lru, mapError, videoId } from './runtime.ts'
import { music } from './music.ts'
import { healthStatus, startUpdate } from './admin.ts'

type Resolved = { headers?: Record<string, string>; url: string; duration: number; source: string; mime: string; bitrate: number; expires: number }

const STATIC_PIPED = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.private.coffee', 'https://pipedapi.r4fo.com', 'https://pipedapi.leptons.xyz']
const STATIC_INV = ['https://inv.nadeko.net', 'https://invidious.nerdvpn.de', 'https://yewtu.be', 'https://invidious.f5.si', 'https://iv.melmac.space']
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36'

const cache = new Lru<Resolved>()
const pending = new Map<string, Promise<Resolved>>()
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
async function viaYtDlp(id: string): Promise<Resolved> {
  const j = await extract(['-j', '--no-playlist', '-f', 'bestaudio[ext=m4a]/bestaudio', '--', 'https://www.youtube.com/watch?v=' + id])
  if (j.is_live || ['is_live', 'is_upcoming'].includes(j.live_status)) throw new ApiError('live_not_supported', 'Transmissões ao vivo não são suportadas.')
  if (!j.url || !/^https?:$/.test(new URL(j.url).protocol)) throw new ApiError('extractor_outdated', 'Atualize o yt-dlp no painel Motor local.')
  const exp = Number(new URL(j.url).searchParams.get('expire')) * 1000 || Date.now() + 3600000
  return { url: j.url, headers: j.http_headers, duration: j.duration, mime: j.ext === 'm4a' ? 'audio/mp4' : 'audio/' + j.ext, bitrate: (j.abr ?? 0) * 1000, source: 'yt-dlp local', expires: exp - 60000 }
}

const firstOk = <T,>(ps: Promise<T>[]) => new Promise<T>((ok, ko) => { let n = ps.length; if (!n) ko(new Error('none')); ps.forEach((p) => p.then(ok, () => --n || ko(new Error('all failed')))) })

async function resolve(id: string): Promise<Resolved> {
  const hit = cache.get(id); if (hit) return hit
  if (pending.has(id)) return pending.get(id)!
  const work = (async () => {
    let r: Resolved
    try { r = await viaYtDlp(id) }
    catch (error) {
      if (process.env.RELAY_PUBLIC_FALLBACK !== '1') throw error
      await refreshPool()
      r = await firstOk([...ranked(pool.piped).map((b) => viaPiped(b, id).then((r) => probe(r, b))), ...ranked(pool.inv).map((b) => viaInvidious(b, id).then((r) => probe(r, b)))])
    }
    cache.set(id, r, r.expires); return r
  })()
  pending.set(id, work)
  try { return await work } finally { pending.delete(id) }
}

const send = (res: Parameters<Connect.NextHandleFunction>[1], code: number, body: unknown) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)) }

export const handler: Connect.NextHandleFunction = async (req, res, next) => {
  const u = new URL(req.url ?? '/', 'http://localhost')
  if (u.pathname !== '/health' && !u.pathname.startsWith('/api/')) return next()
  const origin = process.env.RELAY_CORS_ORIGIN
  if (origin && origin !== '*' && req.headers.origin === origin && !u.pathname.startsWith('/api/admin/')) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'Origin')
    res.setHeader('access-control-allow-headers', 'range')
    res.setHeader('access-control-allow-methods', 'GET, HEAD')
    res.setHeader('access-control-expose-headers', 'content-range, content-length, accept-ranges')
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end() }
  }
  try {
    if (u.pathname.startsWith('/api/admin/')) {
      if (u.search || Number(req.headers['content-length'] || 0) || req.headers['transfer-encoding']) throw new ApiError('invalid_input', 'Este endpoint não aceita parâmetros.', 400)
      if (u.pathname === '/api/admin/update-status' && req.method === 'GET') return send(res, 200, await healthStatus())
      if (req.method !== 'POST' || req.headers['sec-fetch-site'] !== 'same-origin' || req.headers['x-stormusic'] !== '1') throw new ApiError('forbidden', 'Abra o painel Motor local para atualizar.', 403)
      if (!['/api/admin/update-ytdlp', '/api/admin/update-app'].includes(u.pathname)) throw new ApiError('not_found', 'Endpoint não encontrado.', 404)
      return send(res, 202, await startUpdate(u.pathname.endsWith('update-app') ? 'app' : 'ytdlp'))
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError('method_not_allowed', 'Método não permitido.', 405)
    if (u.pathname === '/health') return send(res, 200, await healthStatus())
    if (['/api/v1/audio/search', '/api/v1/audio/related'].includes(u.pathname)) {
      const kind = u.pathname.endsWith('search') ? 'search' : 'related'
      const value = (u.searchParams.get(kind === 'search' ? 'q' : 'id') ?? '').trim()
      const limit = Number(u.searchParams.get('limit') ?? 25)
      if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (kind === 'search' ? !value || value.length > 200 : !videoId.test(value))) throw new ApiError('invalid_input', 'Busca, ID ou limite inválido.', 400)
      return send(res, 200, { [kind === 'search' ? 'query' : 'id']: value, results: await music(kind, value, limit) })
    }
    if (u.pathname.startsWith('/api/resolve/')) {
      const id = u.pathname.slice('/api/resolve/'.length)
      if (!videoId.test(id)) throw new ApiError('invalid_input', 'ID de vídeo inválido.', 400)
      const r = await resolve(id)
      return send(res, 200, { url: '/api/audio?id=' + id, duration: r.duration, source: r.source, mime: r.mime, bitrate: r.bitrate })
    }
    if (u.pathname === '/api/audio') {
      const id = u.searchParams.get('id') ?? ''
      if (!videoId.test(id)) throw new ApiError('invalid_input', 'ID de vídeo inválido.', 400)
      if (req.headers.range && !/^bytes=([0-9]+-[0-9]*|-[0-9]+)$/.test(req.headers.range)) throw new ApiError('invalid_range', 'Intervalo inválido.', 416)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 180000)
      const stop = () => { clearTimeout(timer); controller.abort() }
      res.once('close', stop)
      try {
        let r = await resolve(id)
        let up: Response | undefined
        for (let attempt = 0; attempt < 2; attempt++) {
          up = await fetch(r.url, { signal: controller.signal, headers: { 'user-agent': UA, ...r.headers, ...(req.headers.range ? { range: req.headers.range } : {}) } })
          if (![403, 410].includes(up.status) || attempt === 1) break
          await up.body?.cancel(); cache.delete(id); r = await resolve(id)
        }
        if (!up) throw new Error('upstream')
        if (!up.ok && up.status !== 416) { await up.body?.cancel(); throw new ApiError('source_blocked', 'O YouTube recusou este IP; tente em outra rede', 502, true) }
        res.statusCode = up.status
        res.setHeader('cache-control', 'no-store')
        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(h); if (v) res.setHeader(h, v) }
        if (!up.headers.get('content-type')) res.setHeader('content-type', r.mime)
        if (req.method === 'HEAD' || !up.body) { await up.body?.cancel(); stop(); return res.end() }
        const stream = Readable.fromWeb(up.body as never)
        stream.once('error', () => res.destroy())
        res.once('close', () => stream.destroy())
        stream.pipe(res)
        return
      } catch (e) { stop(); throw e }
    }
    throw new ApiError('not_found', 'Endpoint não encontrado.', 404)
  } catch (error) {
    const e = mapError(error)
    if (res.headersSent) return res.destroy()
    return send(res, e.status, { error: { code: e.code, message: e.message, retryable: e.retryable } })
  }
}

export default function streamRelay(): Plugin {
  return { name: 'stream-relay', configureServer: (s) => void s.middlewares.use(handler), configurePreviewServer: (s) => void s.middlewares.use(handler) }
}
