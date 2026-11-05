import { ApiError, videoId } from './runtime.ts'
import { atomic, library, readState, saveLibrary, type Track, MAX_DOWNLOADS, mutateLibrary, deleteAudioFiles } from './library.ts'
export type Plan = { version: 1; at: number; tracks: Track[] }
export async function readPlan(): Promise<Plan> {
  const plan = await readState<Plan>('plan.json', { version: 1, at: 0, tracks: [] })
  const removed = new Set((await library()).tracks.filter(t => t.removed).map(t => t.id))
  return { ...plan, tracks: plan.tracks.filter(t => !removed.has(t.id)).slice(0, MAX_DOWNLOADS) }
}
export function validatePlan(body: any): Track[] {
  if (!body || !Array.isArray(body.tracks) || body.tracks.length > MAX_DOWNLOADS || (body.immediate !== undefined && typeof body.immediate !== 'boolean')) throw new ApiError('invalid_input', 'Envie até 40 faixas.', 400)
  const ids = new Set<string>()
  return body.tracks.map((t: any) => {
    if (!t || typeof t.id !== 'string' || !videoId.test(t.id) || ids.has(t.id) ||
      typeof t.title !== 'string' || !t.title.trim() || t.title.length > 300 || typeof t.artist !== 'string' || !t.artist.trim() || t.artist.length > 200 ||
      (t.album !== undefined && (typeof t.album !== 'string' || t.album.length > 300)) ||
      (t.duration !== undefined && (!Number.isFinite(t.duration) || t.duration < 0 || t.duration > 14400))) throw new ApiError('invalid_input', 'Metadados de faixa inválidos.', 400)
    ids.add(t.id); return { id: t.id, title: t.title.trim(), artist: t.artist.trim(), album: t.album || '', duration: t.duration || 0 }
  })
}
function newEntry(t: Track, now: number) {
  return { ...t, status: 'queued' as const, bytes: 0, total: 0, percent: 0, attempts: 0, error: null, updatedAt: now, addedAt: now }
}
export function savePlan(body: unknown, now = Date.now()) {
  const submitted = validatePlan(body)
  return mutateLibrary(async () => {
    const state = await library()
    const tracks = submitted.filter(t => !state.tracks.some(e => e.id === t.id && e.removed))
    const wanted = new Set(tracks.map(t => t.id))
    for (const entry of state.tracks) entry.outsideSince = wanted.has(entry.id) ? undefined : entry.outsideSince || now
    await atomic('plan.json', { version: 1, at: now, tracks })
    // Updating recommendations must not replace a full offline collection all day.
    let slots = MAX_DOWNLOADS - state.tracks.filter(t => !t.removed).length
    for (const t of tracks) {
      const existing = state.tracks.find(e => e.id === t.id)
      if (existing) Object.assign(existing, { ...t, duration: t.duration || existing.duration })
      else if (slots > 0) { state.tracks.push(newEntry(t, now)); slots-- }
    }
    await saveLibrary()
    return { accepted: tracks.length, missing: tracks.filter(t => state.tracks.find(e => e.id === t.id)?.status !== 'done').length }
  })
}
/** Replace old slots only when the scheduled batch actually starts. */
export function prepareDownloadPlan(now = Date.now()) {
  return mutateLibrary(async () => {
    const state = await library(), plan = await readPlan()
    const desired = new Set(plan.tracks.map(t => t.id))
    const extras = state.tracks.filter(t => !t.removed && !desired.has(t.id)).sort((a,b) => b.addedAt - a.addedAt)
    const keep = new Set([...desired, ...extras.slice(0, MAX_DOWNLOADS - desired.size).map(t => t.id)])
    const evicted = state.tracks.filter(t => !t.removed && !keep.has(t.id))
    for (const track of evicted) await deleteAudioFiles(track.id)
    state.tracks = state.tracks.filter(t => !evicted.includes(t))
    for (const t of plan.tracks) if (!state.tracks.some(e => e.id === t.id)) state.tracks.push(newEntry(t, now))
    await saveLibrary()
  })
}
