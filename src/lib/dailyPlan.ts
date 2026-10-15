import type { Track } from './data'
export type DailyPlan = { at: number; tracks: Track[] }
export type PlanEvent = { y: string; k: string; at: number }
export function buildPlan({ previous, events, candidates, now, size = 25, minMinutes = 120, maxTracks = 40 }: {
  previous: DailyPlan | null; events: PlanEvent[]; candidates: Track[]; now: number; size?: number; minMinutes?: number; maxTracks?: number
}): DailyPlan {
  const consumed = new Set(events.filter(e => e.at >= (previous?.at || 0) && e.at <= now && ['listen', 'skip', 'dislike'].includes(e.k)).map(e => e.y))
  const recent = new Set(events.filter(e => now - e.at < 86400000 && ['listen', 'skip', 'dislike'].includes(e.k)).map(e => e.y))
  const tracks: Track[] = [], seen = new Set<string>(); let seconds = 0
  const add = (track: Track) => { if (seen.has(track.ytId) || tracks.length >= maxTracks) return; seen.add(track.ytId); tracks.push({ ...track }); seconds += Math.max(0, track.dur || 0) }
  for (const track of previous?.tracks || []) if (!consumed.has(track.ytId)) add(track)
  for (const track of candidates) { if (tracks.length >= size && seconds >= minMinutes * 60) break; if (!recent.has(track.ytId)) add(track) }
  return { at: now, tracks }
}
