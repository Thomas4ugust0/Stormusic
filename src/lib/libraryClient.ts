import type { Track } from './data'
import { localRequest } from './stream'
export type LibraryTrack = { id: string; title: string; artist: string; album: string; duration: number; status: 'queued' | 'resolving' | 'downloading' | 'done' | 'failed'; bytes: number; total: number; percent: number; attempts: number; error: string | null; updatedAt: number; cleanupEligible?: boolean }
export type Library = { tracks: LibraryTrack[]; summary: { done: number; total: number; failed: number; bytes: number; minutes: number; etaSec: number | null; running: boolean; currentId: string | null; nextRunAt: number; windowEndAt: number; lastRunAt: number; lastRunStatus: string; pauseUntil: number } }
export async function libraryRequest(path = '', method = 'GET', body?: unknown) {
  return localRequest('/api/v1/library' + path, { method, headers: { 'X-Stormusic': '1', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, 10000)
}
export async function sendPlan(tracks: Track[], immediate: boolean) {
  await localRequest('/api/v1/plan', { method: 'PUT', headers: { 'X-Stormusic': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ tracks: tracks.map(t => ({ id: t.ytId, title: t.title, artist: t.artist, album: t.sub, duration: t.dur || 0 })), immediate }) }, 15000)
}
