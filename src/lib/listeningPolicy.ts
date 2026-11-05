/** Shared, persistent policy for automatic plans, queues and offline copies. */
export const DAY_MS = 86400000
export const REPEAT_DAYS_KEY = 'ytm.repeatDays'
const REMOVED_KEY = 'ytm.removedDownloads'
export function normalizeRepeatDays(value: unknown): number {
  const days = Number(value)
  return Number.isInteger(days) && days >= 1 && days <= 10 ? days : 1
}
export function getRepeatDays(): number {
  try { return normalizeRepeatDays(localStorage.getItem(REPEAT_DAYS_KEY)) } catch { return 1 }
}
export function setRepeatDays(days: number) {
  localStorage.setItem(REPEAT_DAYS_KEY, String(normalizeRepeatDays(days)))
}
export function removedDownloads(): string[] {
  try { const ids = JSON.parse(localStorage.getItem(REMOVED_KEY) || '[]'); return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [] } catch { return [] }
}
export const isDownloadRemoved = (id: string) => removedDownloads().includes(id)
export function rememberRemovedDownloads(ids: string[]) {
  localStorage.setItem(REMOVED_KEY, JSON.stringify([...new Set([...removedDownloads(), ...ids])]))
}
export function recentIds(events: { y: string; k: string; at: number }[], now: number, days = getRepeatDays()) {
  return new Set(events.filter(e => e.at <= now && now - e.at < normalizeRepeatDays(days) * DAY_MS && ['listen', 'skip'].includes(e.k)).map(e => e.y))
}
export function dislikedIds(events: { y: string; k: string }[]) {
  const ids = new Set<string>()
  for (const e of events) {
    if (e.k === 'dislike') ids.add(e.y)
    else if (e.k === 'like' || e.k === 'unlike') ids.delete(e.y)
  }
  return ids
}
