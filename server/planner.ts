import { ApiError, videoId } from './runtime.ts'
import { atomic, library, readState, saveLibrary, type Track } from './library.ts'
export type Plan = { version: 1; at: number; tracks: Track[] }
export const readPlan = () => readState<Plan>('plan.json', { version: 1, at: 0, tracks: [] })
export function validatePlan(body: any): Track[] {
  if (!body || !Array.isArray(body.tracks) || body.tracks.length < 1 || body.tracks.length > 60 || (body.immediate !== undefined && typeof body.immediate !== 'boolean')) throw new ApiError('invalid_input', 'Envie de 1 a 60 faixas.', 400)
  const ids = new Set<string>()
  return body.tracks.map((t: any) => {
    if (!t || typeof t.id !== 'string' || !videoId.test(t.id) || ids.has(t.id) ||
      typeof t.title !== 'string' || !t.title.trim() || t.title.length > 300 || typeof t.artist !== 'string' || !t.artist.trim() || t.artist.length > 200 ||
      (t.album !== undefined && (typeof t.album !== 'string' || t.album.length > 300)) ||
      (t.duration !== undefined && (!Number.isFinite(t.duration) || t.duration < 0 || t.duration > 14400))) throw new ApiError('invalid_input', 'Metadados de faixa inválidos.', 400)
    ids.add(t.id); return { id: t.id, title: t.title.trim(), artist: t.artist.trim(), album: t.album || '', duration: t.duration || 0 }
  })
}
export async function savePlan(body: unknown, now = Date.now()) {
  const tracks = validatePlan(body), state = await library()
  if (state.tracks.length + tracks.filter(t => !state.tracks.some(e => e.id === t.id)).length > 2000) throw new ApiError('library_full', 'Biblioteca cheia. Remova faixas antigas antes de continuar.', 409)
  const wanted = new Set(tracks.map(t => t.id))
  for (const entry of state.tracks) entry.outsideSince = wanted.has(entry.id) ? undefined : entry.outsideSince || now
  await atomic('plan.json', { version: 1, at: now, tracks })
  for (const t of tracks) {
    const existing = state.tracks.find(x => x.id === t.id)
    if (existing) { Object.assign(existing, { ...t, duration: t.duration || existing.duration }); if (existing.removed && (body as { immediate?: boolean }).immediate) { existing.removed = false; existing.status = 'queued'; existing.attempts = 0 } }
    else state.tracks.push({ ...t, status: 'queued', bytes: 0, total: 0, percent: 0, attempts: 0, error: null, updatedAt: now, addedAt: now })
  }
  await saveLibrary()
  return { accepted: tracks.length, missing: tracks.filter(t => state.tracks.find(x => x.id === t.id)?.status !== 'done').length }
}
