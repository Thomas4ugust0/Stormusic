import { TRACKS, type Track, type Mood } from './data'

export type Profile = { genres: string[]; subs: string[]; artists: string[] }
export type Feedback = { liked: string[]; disliked: string[]; played: string[] }

// Score every track against the interest tree + live feedback; then interleave
// "known" (artist chosen / liked) with "discovery" (same genre tree, new artist).
export function score(t: Track, p: Profile, f: Feedback, mood: Mood | 'all') {
  if (f.disliked.includes(t.id)) return -Infinity
  if (!p.genres.includes(t.genre)) return -Infinity // strictly inside interest tree
  let s = 1
  if (p.subs.includes(t.sub)) s += 2
  if (p.artists.includes(t.artist)) s += 3
  const likedT = TRACKS.filter((x) => f.liked.includes(x.id))
  const dislikedT = TRACKS.filter((x) => f.disliked.includes(x.id))
  s += likedT.filter((x) => x.artist === t.artist).length * 2.5 + likedT.filter((x) => x.sub === t.sub).length * 1.2
  s -= dislikedT.filter((x) => x.artist === t.artist).length * 3 + dislikedT.filter((x) => x.sub === t.sub).length * 1.2
  if (likedT.length) s -= Math.abs(t.energy - likedT.reduce((a, x) => a + x.energy, 0) / likedT.length) * 2
  if (mood !== 'all') s += t.moods.includes(mood) ? 4 : -4
  if (f.liked.includes(t.id)) s += 1.5
  s -= f.played.slice(-12).filter((id) => id === t.id).length * 3 // freshness
  return s + Math.random() * 0.8
}

export const isKnown = (t: Track, p: Profile, f: Feedback) => p.artists.includes(t.artist) || f.liked.includes(t.id) || TRACKS.some((x) => f.liked.includes(x.id) && x.artist === t.artist)

export function buildBlock(p: Profile, f: Feedback, mood: Mood | 'all', exclude: string[] = [], size = 10): Track[] {
  const ranked = TRACKS.filter((t) => !exclude.includes(t.id)).map((t) => ({ t, s: score(t, p, f, mood) })).filter((x) => x.s > -Infinity).sort((a, b) => b.s - a.s)
  const known = ranked.filter((x) => isKnown(x.t, p, f)).map((x) => x.t)
  const disc = ranked.filter((x) => !isKnown(x.t, p, f)).map((x) => x.t)
  const out: Track[] = []
  while (out.length < size && (known.length || disc.length)) {
    // ~60% familiar / 40% discovery
    const pick = (out.length % 5 < 3 ? known.shift() ?? disc.shift() : disc.shift() ?? known.shift())!
    out.push(pick)
  }
  if (out.length < size && exclude.length) return [...out, ...buildBlock(p, f, mood, [], size - out.length).filter((t) => !out.includes(t))]
  return out
}
