// Personal taste model + online Supermix generator.
//
// Signals (per YouTube id, time-decayed):
//   like +4 · listened >= 30s +1 · skipped < 30s -1 · dislike -6
// Candidates come from the YouTube Music "radio" of several seed tracks (the platform's own
// recommendation algorithm). They are then filtered (no repeats in 24h, no variations of the same
// song, no disliked artists) and blended ~80% comfort (known taste) / ~20% discovery (new artists).
import { TRACKS, type Track } from './data'
import { relatedMusic, type SearchHit } from './stream'
import type { Profile } from './supermix'

export type Signal = 'listen' | 'skip' | 'like' | 'dislike' | 'unlike'
type Ev = { y: string; k: Signal; at: number }
type Meta = { title: string; artist: string; dur: number; sub: string }
type Store = { ev: Ev[]; meta: Record<string, Meta> }
export type Kind = 'fav' | 'disc'
export type Mix = { at: number; tracks: Track[]; kinds: Record<string, Kind>; online: boolean }

export const REFRESH_MS = 12 * 3600_000
const RECENT_MS = 24 * 3600_000
const HALF_LIFE_MS = 21 * 24 * 3600_000
const W: Record<Signal, number> = { like: 4, listen: 1, skip: -1, dislike: -6, unlike: -4 }
const KEY = 'ytm.taste'
const MIX_KEY = 'ytm.supermix'

const load = (): Store => { try { const s = JSON.parse(localStorage.getItem(KEY) || ''); return { ev: s.ev ?? [], meta: s.meta ?? {} } } catch { return { ev: [], meta: {} } } }
let store = load()
const save = () => localStorage.setItem(KEY, JSON.stringify(store))

/** Preserve resolved metadata without adding a taste signal. */
export function rememberDuration(id: string, duration: number, track?: Track) {
  if (!Number.isFinite(duration) || duration < 0) return
  const t = track || TRACKS.find((t) => t.ytId === id)
  const previous = store.meta[id]
  if (previous || t) {
    store.meta[id] = { title: previous?.title || t!.title, artist: previous?.artist || t!.artist, sub: previous?.sub || t!.sub, dur: duration || previous?.dur || 0 }
    save()
  }
  const mix = savedMix()
  if (mix?.tracks.some((t) => t.ytId === id)) {
    for (const t of mix.tracks) if (t.ytId === id) { t.dur = duration; store.meta[id] = { title: t.title, artist: t.artist, sub: t.sub, dur: duration } }
    localStorage.setItem(MIX_KEY, JSON.stringify(mix)); save()
  }
}
export const knownDuration = (id: string, fallback = 0) => store.meta[id]?.dur || fallback

// --- normalisation: detects "variations of the same song" ----------------------------------
const NOISE = /\b(feat|ft|featuring|with|remaster(ed)?|\d{4} remaster|live|ao vivo|acoustic|acustico|remix|mix|edit|radio edit|extended|version|versao|cover|karaoke|instrumental|lyrics?|letra|legendado|official|oficial|video|clipe|audio|visualizer|hd|4k|sped up|slowed|reverb|nightcore|8d|mono|stereo|demo|deluxe|bonus track)\b/g
export function titleKey(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, ' ')
    .replace(/\s[-–—|:]\s.*$/, ' ')
    .replace(/\b(feat|ft)\.?\s.*$/, ' ')
    .replace(NOISE, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
}
export const artistKey = (a: string) => a.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/,|&| x | e | feat\.?| ft\.?/)[0].replace(/[^a-z0-9]+/g, ' ').trim()
const sameSong = (a: string, b: string) => !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a))))

// --- signals --------------------------------------------------------------------------------
export function record(t: Track, k: Signal) {
  store.meta[t.ytId] = { title: t.title, artist: t.artist, dur: knownDuration(t.ytId, t.dur), sub: t.sub }
  store.ev.push({ y: t.ytId, k, at: Date.now() })
  if (store.ev.length > 3000) store.ev = store.ev.slice(-3000)
  save()
}
/** Called when playback leaves a track. */
export function recordPlayback(t: Track, listenedSec: number, finished: boolean) {
  if (finished || listenedSec >= 30) record(t, 'listen')
  else if (listenedSec >= 1) record(t, 'skip')
}

const decay = (at: number, now: number) => Math.pow(0.5, (now - at) / HALF_LIFE_MS)

function model(profile: Profile | null) {
  const now = Date.now()
  const track = new Map<string, number>()
  const artist = new Map<string, number>()
  const recent = new Set<string>()
  const recentKeys: string[] = []
  for (const e of store.ev) {
    const m = store.meta[e.y]; if (!m) continue
    const w = W[e.k] * decay(e.at, now)
    track.set(e.y, (track.get(e.y) ?? 0) + w)
    const ak = artistKey(m.artist)
    artist.set(ak, (artist.get(ak) ?? 0) + w * (e.k === 'listen' || e.k === 'skip' ? 0.5 : 0.8))
    if (now - e.at < RECENT_MS && (e.k === 'listen' || e.k === 'skip')) { recent.add(e.y); recentKeys.push(titleKey(m.title)) }
  }
  // explicit like/dislike state = last explicit vote
  const vote = new Map<string, Signal>()
  for (const e of store.ev) if (e.k === 'like' || e.k === 'dislike') vote.set(e.y, e.k); else if (e.k === 'unlike') vote.delete(e.y)
  for (const a of profile?.artists ?? []) artist.set(artistKey(a), (artist.get(artistKey(a)) ?? 0) + 2)
  return { track, artist, recent, recentKeys, vote }
}

export const isLiked = (ytId: string) => { let v: Signal | undefined; for (const e of store.ev) if (e.y === ytId && (e.k === 'like' || e.k === 'dislike' || e.k === 'unlike')) v = e.k; return v === 'like' }
export function likedTracks(): Track[] {
  const m = model(null)
  return [...m.vote].filter(([, v]) => v === 'like').map(([y]) => toTrack(y)).filter((t): t is Track => !!t).reverse()
}
export const stats = () => { const m = model(null); return { signals: store.ev.length, liked: [...m.vote.values()].filter((v) => v === 'like').length, artists: [...m.artist.values()].filter((v) => v > 0.5).length } }

function toTrack(y: string): Track | null {
  const local = TRACKS.find((t) => t.ytId === y); if (local) return { ...local, dur: knownDuration(y, local.dur) }
  const m = store.meta[y]; if (!m) return null
  return { id: 'yt:' + y, ytId: y, title: m.title, artist: m.artist, genre: 'yt', sub: m.sub || 'Música', moods: [], energy: 0.5, dur: m.dur }
}
export const hitToTrack = (h: SearchHit): Track => ({ id: 'yt:' + h.id, ytId: h.id, title: h.title, artist: h.artist || 'Desconhecido', genre: 'yt', sub: h.album || 'Música', moods: [], energy: 0.5, dur: knownDuration(h.id, h.duration ?? 0) })

// --- generator ------------------------------------------------------------------------------
type Cand = { t: Track; rank: number; votes: number }

function pickSeeds(profile: Profile | null, m: ReturnType<typeof model>, n: number): Track[] {
  // Weighted sampling over positive tracks, max 2 per artist, so the mix covers the whole taste.
  const pos = [...m.track].filter(([y, s]) => s > 0.3 && m.vote.get(y) !== 'dislike').map(([y, s]) => ({ t: toTrack(y), s })).filter((x): x is { t: Track; s: number } => !!x.t)
  const out: Track[] = []; const per = new Map<string, number>()
  while (out.length < n && pos.length) {
    const total = pos.reduce((a, x) => a + x.s, 0); let r = Math.random() * total; let i = 0
    for (; i < pos.length - 1; i++) { r -= pos[i].s; if (r <= 0) break }
    const [x] = pos.splice(i, 1); const ak = artistKey(x.t.artist)
    if ((per.get(ak) ?? 0) >= 2) continue
    per.set(ak, (per.get(ak) ?? 0) + 1); out.push(x.t)
  }
  // Cold start: onboarding artists.
  if (out.length < 3) for (const a of [...(profile?.artists ?? [])].sort(() => Math.random() - 0.5)) {
    const t = TRACKS.filter((x) => x.artist === a).sort(() => Math.random() - 0.5)[0]
    if (t && !out.some((o) => o.ytId === t.ytId)) out.push(t)
    if (out.length >= n) break
  }
  return out
}

async function candidates(seeds: Track[]): Promise<Map<string, Cand>> {
  const pool = new Map<string, Cand>()
  const res = await Promise.allSettled(seeds.map((s) => relatedMusic(s.ytId)))
  res.forEach((r) => {
    if (r.status !== 'fulfilled') return
    r.value.forEach((h, i) => {
      const c = pool.get(h.id) ?? { t: hitToTrack(h), rank: 0, votes: 0 }
      c.rank += 1 - i / Math.max(1, r.value.length); c.votes += 1; pool.set(h.id, c)
    })
  })
  if (!pool.size && res.some((r) => r.status === 'rejected')) throw (res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason
  return pool
}

/**
 * Blend candidates into an ordered list: ~80% comfort / 20% discovery, no repeats from the last
 * 24h, no variations of songs already chosen/seeded/recent, artist spread.
 */
function blend(pool: Map<string, Cand>, m: ReturnType<typeof model>, size: number, avoid: { ids: Set<string>; keys: string[] }, seedKeys: string[], anchor?: string) {
  const banned = [...avoid.keys, ...seedKeys, ...m.recentKeys]
  const comfort: { t: Track; s: number }[] = []; const disc: { t: Track; s: number }[] = []
  for (const c of pool.values()) {
    const y = c.t.ytId, key = titleKey(c.t.title), aff = m.artist.get(artistKey(c.t.artist)) ?? 0
    if (avoid.ids.has(y) || m.recent.has(y) || m.vote.get(y) === 'dislike' || aff < -1.5) continue
    if ((m.track.get(y) ?? 0) < -0.5) continue // repeatedly skipped
    if (banned.some((b) => sameSong(b, key))) continue
    // Radio: the searched artist and the algorithm's top-ranked picks count as "comfort" too.
    const known = aff > 0.6 || (m.track.get(y) ?? 0) > 0.5 || (!!anchor && (artistKey(c.t.artist) === anchor || c.rank >= 0.45))
    const s = c.rank + c.votes * 0.6 + Math.random() * 0.5
    if (known) comfort.push({ t: c.t, s: s + Math.min(aff, 6) * 0.5 + (m.vote.get(y) === 'like' ? 1.5 : 0) })
    else if (c.votes >= 1) disc.push({ t: c.t, s: s + c.votes * 0.4 }) // consensus across seeds = still in taste
  }
  // Re-surface the user's own favourites (not heard in 24h) as comfort material too.
  for (const [y, sc] of m.track) {
    if (sc < 1 || m.recent.has(y) || avoid.ids.has(y) || pool.has(y) || m.vote.get(y) === 'dislike') continue
    const t = toTrack(y); if (t) comfort.push({ t, s: 0.4 + Math.min(sc, 6) * 0.25 + Math.random() * 0.8 })
  }
  comfort.sort((a, b) => b.s - a.s); disc.sort((a, b) => b.s - a.s)

  const out: Track[] = []; const kinds: Record<string, Kind> = {}; const keys: string[] = []; const per = new Map<string, number>()
  const take = (list: { t: Track; s: number }[], maxPerArtist: number) => {
    const prevA = out.length ? artistKey(out[out.length - 1].artist) : ''
    const i = list.findIndex(({ t }) => {
      const ak = artistKey(t.artist), k = titleKey(t.title)
      return ak !== prevA && (per.get(ak) ?? 0) < maxPerArtist && !keys.some((x) => sameSong(x, k))
    })
    if (i < 0) return null
    const [{ t }] = list.splice(i, 1); const ak = artistKey(t.artist)
    per.set(ak, (per.get(ak) ?? 0) + 1); keys.push(titleKey(t.title)); return t
  }
  const maxC = Math.max(2, Math.ceil(size / 12))
  while (out.length < size) {
    const wantDisc = out.length % 5 === 3 // 1 in 5 = 20% discovery
    const nDisc = Object.values(kinds).filter((k) => k === 'disc').length
    const discOk = nDisc + 1 <= Math.ceil((out.length + 1) * 0.2) // discoveries capped at ~20%
    // Comfort: relax the per-artist cap step by step before giving up (few known artists).
    const fav: [typeof disc, number, Kind][] = [[comfort, maxC, 'fav'], [comfort, maxC * 2, 'fav'], [comfort, Infinity, 'fav']]
    const order: [typeof disc, number, Kind][] = wantDisc ? [[disc, 1, 'disc'], ...fav] : [...fav, ...(discOk ? [[disc, 1, 'disc'] as [typeof disc, number, Kind]] : [])]
    let t: Track | null = null
    for (const [list, max, kind] of order) { t = take(list, max); if (t) { kinds[t.ytId] = kind; break } }
    if (!t) break
    out.push(t)
  }
  return { tracks: out, kinds }
}

/** Full Supermix: many seeds across the taste profile. */
export async function generateSupermix(profile: Profile | null, size = 30): Promise<Mix> {
  const m = model(profile)
  const seeds = pickSeeds(profile, m, 6)
  const pool = await candidates(seeds)
  const { tracks, kinds } = blend(pool, m, size, { ids: new Set(), keys: [] }, [])
  const mix: Mix = { at: Date.now(), tracks, kinds, online: true }
  if (tracks.length >= 8) localStorage.setItem(MIX_KEY, JSON.stringify(mix))
  return mix
}

/** Radio from one track (e.g. a search result): never variations of it. */
export async function radioFrom(seed: Track, exclude: Track[], size = 20) {
  const m = model(null)
  const pool = await candidates([seed])
  return blend(pool, m, size, { ids: new Set([seed.ytId, ...exclude.map((t) => t.ytId)]), keys: exclude.map((t) => titleKey(t.title)) }, [titleKey(seed.title)], artistKey(seed.artist))
}

/** Infinite queue: seeds = recently enjoyed tracks in the queue + global taste. */
export async function extend(queue: Track[], profile: Profile | null, size = 12) {
  const m = model(profile)
  const tail = queue.slice(-8).filter((t) => (m.track.get(t.ytId) ?? 0) >= 0).slice(-2)
  const seeds = [...tail, ...pickSeeds(profile, m, 2)].filter((t, i, a) => a.findIndex((x) => x.ytId === t.ytId) === i)
  const pool = await candidates(seeds)
  return blend(pool, m, size, { ids: new Set(queue.map((t) => t.ytId)), keys: queue.slice(-40).map((t) => titleKey(t.title)) }, [])
}

export function savedMix(): Mix | null {
  try { const x: Mix = JSON.parse(localStorage.getItem(MIX_KEY) || ''); return x?.tracks?.length ? x : null } catch { return null }
}
export const isStale = (mix: Mix | null) => !mix || Date.now() - mix.at > REFRESH_MS
