import { libraryRequest } from './libraryClient'
import { removeCachedTrack } from './offline'
import { rememberRemovedDownloads } from './listeningPolicy'
const KEY = 'ytm.pendingDownloadDeletes'
export function pendingDownloadDeletes(): string[] {
  try { const value = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(value) ? value.filter(id => typeof id === 'string') : [] } catch { return [] }
}
function queueDelete(id: string) {
  localStorage.setItem(KEY, JSON.stringify([...new Set([...pendingDownloadDeletes(), id])]))
  rememberRemovedDownloads([id])
  window.dispatchEvent(new Event('stormusic-offline'))
}
export async function deleteDownload(id: string) {
  queueDelete(id)
  // Local cleanup must work even when the motor is unreachable. A durable queue retries it.
  const outcomes = await Promise.allSettled([libraryRequest('/' + id, 'DELETE'), removeCachedTrack(id)])
  if (outcomes.some(result => result.status === 'rejected')) throw new Error('Exclusão pendente. Será retomada automaticamente quando o motor e o armazenamento estiverem disponíveis.')
  localStorage.setItem(KEY, JSON.stringify(pendingDownloadDeletes().filter(value => value !== id)))
}
let flushing: Promise<void> | null = null
export function flushDownloadDeletes() {
  return flushing ??= (async () => { for (const id of pendingDownloadDeletes()) await deleteDownload(id) })().finally(() => { flushing = null })
}
