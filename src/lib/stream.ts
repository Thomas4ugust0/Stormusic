// Local mode uses only same-origin extraction; the cascade below is legacy.
// Client side of the legacy pipeline. Order of attempts:
//  0. AudioFlow API (own backend, see audioflow/) when configured: job → poll → authenticated download.
//  1. Own relay (/api/resolve) — server-side, no CORS, races many Piped/Invidious
//     instances and proxies the full-length audio with Range support.
//  2. Direct Piped call from the browser (works when an instance sends CORS headers).
//  3. Royalty-free demo stream, so the UI never dead-ends.
// Only a plain HTML5 <audio> is used: no YouTube IFrame, Data API or ad scripts.
import { offlineUrl } from './offline'
import { rememberDuration } from './taste'

export const getMode = (): 'local' | 'audioflow' => localStorage.getItem('ytm.mode') === 'audioflow' ? 'audioflow' : 'local'
export const setMode = (mode: 'local' | 'audioflow') => { localStorage.setItem('ytm.mode', mode); cache.clear() }
export async function localRequest(path: string, init: RequestInit = {}, timeout = 120000): Promise<Response> {
  let response: Response
  try { response = await fetch(path, { ...init, signal: AbortSignal.timeout(timeout) }) }
  catch { throw new Error('Servidor parado. Toque no atalho Stormusic na tela inicial e tente de novo.') }
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message || `Falha no motor local (HTTP ${response.status})`) }
  return response
}
async function localAudio(id: string): Promise<Resolved> {
  const r = await (await localRequest(`/api/resolve/${id}`)).json()
  if (r.duration) rememberDuration(id, r.duration)
  return { ...r, real: true }
}

const LOCAL = import.meta.env.BASE_URL.replace(/\/$/, '')

export function normalizeUrl(raw: string, defaultPort = 8000): string {
  let s = (raw || '').trim().replace(/\/+$/, '')
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) {
    s = 'http://' + s
  }
  try {
    const parsed = new URL(s)
    if (!parsed.port && (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(parsed.hostname) || parsed.hostname === 'localhost' || !parsed.hostname.includes('.'))) {
      parsed.port = String(defaultPort)
      s = parsed.origin
    } else {
      s = parsed.origin
    }
  } catch {
    // fallback to original cleaned string
  }
  return s
}

/** AudioFlow on the same machine that serves this page (e.g. http://192.168.0.3:8000). */
export function pageHostAF(): string {
  const h = location.hostname
  if (!h) return ''
  // Production: frontend and API served by the same Caddy (same origin, no CORS).
  if (location.protocol === 'https:') return import.meta.env.PROD ? location.origin : ''
  return `http://${h.includes(':') ? `[${h}]` : h}:8000`
}

/** Same host as `raw`, but on the AudioFlow port. */
export function afFromHost(raw: string): string {
  const n = normalizeUrl(raw, 8000)
  try { const u = new URL(n); u.port = '8000'; return u.origin } catch { return n }
}

// A user-configured relay takes priority over the built-in one.
export const getRelay = () => localStorage.getItem('ytm.relay') || ''
export const setRelay = (u: string) => {
  const norm = u ? normalizeUrl(u, 8787) : ''
  if (norm) localStorage.setItem('ytm.relay', norm)
  else localStorage.removeItem('ytm.relay')
  cache.clear()
}
const PIPED = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de']
const DEMO = (n: number) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${(n % 16) + 1}.mp3`

// --- AudioFlow API --------------------------------------------------------
export type AudioFlowCfg = { url: string; key: string; format: 'original' | 'm4a' | 'mp3'; sponsors: boolean; terms: boolean }
const AF_DEFAULT: AudioFlowCfg = { url: '', key: '', format: 'original', sponsors: false, terms: true }

export const getAudioFlow = (): AudioFlowCfg => {
  try {
    const saved: Partial<AudioFlowCfg> = JSON.parse(localStorage.getItem('ytm.audioflow') || '{}')
    const relayVal = localStorage.getItem('ytm.relay') || ''
    // If audioflow url is empty, but user entered their IP/host in relay, auto-adopt:
    // (the relay value carries the relay port 8787, so force AudioFlow's port 8000 on that host).
    const url = saved.url ? normalizeUrl(saved.url, 8000) : (relayVal ? afFromHost(relayVal) : pageHostAF())
    return {
      ...AF_DEFAULT,
      ...saved,
      url,
      terms: saved.terms ?? true,
    }
  } catch {
    return { ...AF_DEFAULT, terms: true }
  }
}

export const setAudioFlow = (c: AudioFlowCfg) => {
  const normUrl = normalizeUrl(c.url, 8000)
  localStorage.setItem('ytm.audioflow', JSON.stringify({ ...c, url: normUrl, terms: c.terms ?? true }))
  cache.clear()
}

const afReady = (c: AudioFlowCfg) => Boolean(c.url && (c.terms ?? true))

class AudioFlowError extends Error {
  constructor(public code: string, message: string, public retryable = false) { super(message) }
}

async function af(c: AudioFlowCfg, path: string, init: RequestInit = {}, ms = 15000): Promise<Response> {
  try { return await afOnce(c, path, init, ms) } catch (e) {
    // Saved IP is stale (e.g. DHCP changed it): retry on the host serving this page and remember it.
    const alt = pageHostAF()
    if (!(e instanceof AudioFlowError) || e.code !== 'network_error' || !alt || alt === normalizeUrl(c.url, 8000)) throw e
    const r = await afOnce({ ...c, url: alt }, path, init, ms)
    const saved = JSON.parse(localStorage.getItem('ytm.audioflow') || '{}')
    localStorage.setItem('ytm.audioflow', JSON.stringify({ ...saved, url: alt }))
    return r
  }
}

async function afOnce(c: AudioFlowCfg, path: string, init: RequestInit = {}, ms = 15000): Promise<Response> {
  const normUrl = normalizeUrl(c.url, 8000)
  if (!normUrl) throw new AudioFlowError('no_url', 'URL da AudioFlow não configurada')
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms)
  try {
    const headers: Record<string, string> = { ...(init.body ? { 'Content-Type': 'application/json' } : {}) }
    if (c.key) headers['X-API-Key'] = c.key
    const r = await fetch(normUrl + path, { ...init, headers, signal: ctl.signal })
    if (!r.ok) {
      const e = (await r.json().catch(() => null))?.error
      throw new AudioFlowError(e?.code ?? `http_${r.status}`, (e?.message ?? `HTTP ${r.status}`) + (e?.detail ? ` (${e.detail})` : ''), e?.retryable ?? r.status >= 500)
    }
    return r
  } catch (err: unknown) {
    if (err instanceof AudioFlowError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    if (location.protocol === 'https:' && normUrl.startsWith('http:')) {
      throw new AudioFlowError('mixed_content', `O navegador bloqueia ${normUrl} (http) a partir de uma página https. Abra o frontend via http://192.168.0.3:8443 ou sirva a API com https.`)
    }
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('abort') || msg.includes('Load failed')) {
      throw new AudioFlowError(
        'network_error',
        `Não foi possível alcançar ${normUrl}. Verifique se o Docker está rodando com 'docker compose up -d' dentro de audioflow/ e se a porta 8000 está liberada.`
      )
    }
    throw err
  } finally { clearTimeout(t) }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function viaAudioFlow(c: AudioFlowCfg, ytId: string, onStatus?: (s: string) => void): Promise<Resolved> {
  const norm = { ...c, url: normalizeUrl(c.url, 8000) }
  const body = JSON.stringify({
    source_url: `https://www.youtube.com/watch?v=${ytId}`,
    format: norm.format,
    quality: 'high',
    remove_sponsors: norm.sponsors,
    terms_accepted: true,
  })
  onStatus?.('AudioFlow · criando tarefa…')
  const { job_id } = await (await af(norm, '/api/v1/audio/jobs', { method: 'POST', body })).json()
  const deadline = Date.now() + 180_000
  for (let wait = 600; Date.now() < deadline; wait = Math.min(2500, wait * 1.4)) {
    const s = await (await af(norm, `/api/v1/audio/jobs/${job_id}`)).json()
    if (s.status === 'completed') {
      onStatus?.('AudioFlow · baixando áudio…')
      const r = await af(norm, `/api/v1/audio/jobs/${job_id}/download`, {}, 120_000)
      const blob = await r.blob()
      return {
        blob,
        url: URL.createObjectURL(blob),
        source: `AudioFlow · ${norm.format}${s.warnings?.length ? ' ⚠' : ''}`,
        duration: s.video?.duration_seconds ?? undefined,
        real: true,
      }
    }
    if (s.status === 'failed' || s.status === 'cancelled') {
      throw new AudioFlowError(s.error?.code ?? s.status, s.error?.message ?? s.status, s.error?.retryable)
    }
    onStatus?.(`AudioFlow · ${s.status === 'queued' ? 'na fila' : `${s.progress}%`}`)
    await sleep(wait)
  }
  void af(norm, `/api/v1/audio/jobs/${job_id}`, { method: 'DELETE' }).catch(() => {})
  throw new AudioFlowError('timeout', 'Tempo esgotado aguardando a AudioFlow', true)
}

/** Health check used by the settings panel. */
export async function testAudioFlow(c: AudioFlowCfg): Promise<string> {
  const h = await (await af({ ...c, key: '' }, '/health', {}, 6000)).json()
  return `yt-dlp ${h.ytdlp_version}`
}

export type Resolved = { url: string; source: string; duration?: number; real: boolean; blob?: Blob }
const cache = new Map<string, Resolved>() // blob: URLs from AudioFlow stay alive while cached
const inflight = new Map<string, Promise<Resolved>>()

async function json(url: string, ms: number) {
  const c = new AbortController(); const id = setTimeout(() => c.abort(), ms)
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(String(r.status)); return await r.json() } finally { clearTimeout(id) }
}

/** Full audio file through AudioFlow, used by the offline downloader (no Range, whole file). */
export async function fetchAudioBlob(ytId: string): Promise<Blob> {
  if (getMode() === 'local') {
    const r = await localAudio(ytId)
    const response = await localRequest(r.url, {}, 180000)
    const blob = await response.blob()
    if (!blob.size || !/audio|video|octet-stream/.test(blob.type)) throw new Error('O servidor não retornou um arquivo de áudio válido.')
    return blob
  }
  const c = getAudioFlow()
  if (!afReady(c)) throw new AudioFlowError('no_url', 'AudioFlow não configurada')
  return (await viaAudioFlow(c, ytId)).blob!
}

async function run(ytId: string, idx: number, live: boolean, onStatus?: (s: string) => void): Promise<Resolved> {
  const off = await offlineUrl(ytId).catch(() => null)
  if (off) return { url: off, source: 'Offline', real: true }
  if (getMode() === 'local') { onStatus?.('Resolvendo no celular…'); return localAudio(ytId) }
  if (live && !navigator.onLine) throw new AudioFlowError('offline', 'Sem conexão e faixa não baixada')
  if (live) {
    const c = getAudioFlow()
    if (afReady(c)) {
      try { return await viaAudioFlow(c, ytId, onStatus) } catch (e) {
        lastAudioFlowError = e instanceof Error ? e.message : String(e)
        // Auth/config errors would repeat on every track: report and fall back.
        onStatus?.(`AudioFlow falhou: ${lastAudioFlowError}`)
      }
    }
    for (const base of [...new Set([getRelay() || LOCAL, LOCAL])]) {
      try {
        const j = await json(`${base}/api/resolve/${ytId}`, 50000)
        return { url: base + j.url, source: `Relay → ${j.source}`, duration: j.duration, real: true }
      } catch { /* relay unavailable (e.g. static deploy) */ }
    }
    for (const b of PIPED) {
      try {
        const j = await json(`${b}/streams/${ytId}`, 4000)
        const s = (j.audioStreams as { url: string; bitrate: number }[]).sort((a, c) => c.bitrate - a.bitrate)[0]
        if (s) return { url: s.url, source: 'Piped direto', duration: j.duration, real: true }
      } catch { /* next */ }
    }
  }
  return { url: DEMO(Math.max(0, idx)), source: 'Demo (fallback)', real: false }
}

export let lastAudioFlowError = ''

export function resolveAudio(ytId: string, idx: number, live: boolean, onStatus?: (s: string) => void): Promise<Resolved> {
  const key = ytId + live
  const hit = cache.get(key); if (hit && getMode() !== 'local') return Promise.resolve(hit)
  if (!inflight.has(key)) inflight.set(key, run(ytId, idx, live, onStatus).then((r) => { if (r.real || !live) cache.set(key, r); return r }).finally(() => { inflight.delete(key) }))
  return inflight.get(key)!
}

// Warm the next tracks so skips are instant.
export const prefetch = (ids: { ytId: string; idx: number }[], live: boolean) => ids.forEach((t) => void resolveAudio(t.ytId, t.idx, live).catch(() => {}))
export const invalidate = (ytId: string) => {
  const r = cache.get(ytId + true)
  if (r?.url.startsWith('blob:')) URL.revokeObjectURL(r.url)
  cache.delete(ytId + true)
}

// --- Busca (YouTube Music, somente aba "Músicas") -------------------------
export type SearchHit = { id: string; title: string; artist: string; album?: string | null; duration?: number | null }

export async function searchMusic(q: string): Promise<SearchHit[]> {
  if (getMode() === 'local') return (await (await localRequest(`/api/v1/audio/search?q=${encodeURIComponent(q)}&limit=25`)).json()).results
  const c = getAudioFlow()
  if (!c.url) throw new AudioFlowError('no_url', 'Configure a AudioFlow API (Biblioteca → AudioFlow API) para buscar no YouTube Music')
  const r = await af(c, `/api/v1/audio/search?q=${encodeURIComponent(q)}&limit=25`, {}, 30000)
  return (await r.json()).results as SearchHit[]
}

/** YouTube Music radio for a track: what the YouTube algorithm would play next. */
export async function relatedMusic(ytId: string): Promise<SearchHit[]> {
  if (getMode() === 'local') return (await (await localRequest(`/api/v1/audio/related?id=${encodeURIComponent(ytId)}&limit=25`)).json()).results
  const c = getAudioFlow()
  if (!c.url) throw new AudioFlowError('no_url', 'AudioFlow não configurada')
  const r = await af(c, `/api/v1/audio/related?id=${encodeURIComponent(ytId)}&limit=25`, {}, 30000)
  return (await r.json()).results as SearchHit[]
}
