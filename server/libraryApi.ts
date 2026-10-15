import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, videoId } from './runtime.ts'
import { library, snapshot, removeTrack, saveLibrary } from './library.ts'
import { savePlan } from './planner.ts'
import { runDownloads, isRunning } from './downloads.ts'
import { resolveTrack } from './resolver.ts'

async function body(req: IncomingMessage): Promise<any> {
  let size = 0; const chunks: Buffer[] = []
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new ApiError('invalid_input', 'Pedido muito grande.', 413); chunks.push(Buffer.from(chunk)) }
  try { return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {} } catch { throw new ApiError('invalid_input', 'JSON inválido.', 400) }
}
export async function libraryApi(req: IncomingMessage, res: ServerResponse, path: string) {
  const send = (status: number, value?: unknown) => { res.statusCode = status; res.setHeader('cache-control', 'no-store'); if (value !== undefined) res.setHeader('content-type', 'application/json'); res.end(value === undefined ? undefined : JSON.stringify(value)) }
  if (path === '/api/v1/library' && req.method === 'GET') { send(200, await snapshot()); return }
  if (req.headers['sec-fetch-site'] !== 'same-origin' || req.headers['x-stormusic'] !== '1') throw new ApiError('forbidden', 'Abra o Stormusic para alterar a biblioteca.', 403)
  const value = await body(req)
  if (path === '/api/v1/plan' && req.method === 'PUT') {
    const result = await savePlan(value); send(200, result)
    if (value.immediate) void runDownloads().catch(() => {})
    return
  }
  if (path === '/api/v1/prefetch' && req.method === 'POST') {
    if (!Array.isArray(value.ids) || value.ids.length > 5 || !value.ids.length || value.ids.some((id: unknown) => typeof id !== 'string' || !videoId.test(id))) throw new ApiError('invalid_input', 'Envie de 1 a 5 IDs válidos.', 400)
    for (const id of new Set<string>(value.ids)) void resolveTrack(id, 'prefetch').catch(() => {})
    send(202); return
  }
  if (path === '/api/v1/library/run' && req.method === 'POST') { void runDownloads().catch(() => {}); send(202); return }
  if (path === '/api/v1/library/retry' && req.method === 'POST') {
    if (typeof value.id !== 'string' || !videoId.test(value.id)) throw new ApiError('invalid_input', 'ID inválido.', 400)
    const state = await library(), track = state.tracks.find(t => t.id === value.id && !t.removed)
    if (!track) throw new ApiError('not_found', 'Faixa não encontrada.', 404)
    if (track.status === 'failed') { track.status = 'queued'; track.attempts = 0; track.error = null; await saveLibrary() }
    void runDownloads(0, false).catch(() => {}); send(202); return
  }
  if (path.startsWith('/api/v1/library/') && req.method === 'DELETE') {
    const id = path.slice('/api/v1/library/'.length)
    if (!videoId.test(id)) throw new ApiError('invalid_input', 'ID inválido.', 400)
    if (isRunning()) throw new ApiError('busy', 'Aguarde o lote terminar antes de remover.', 409)
    await removeTrack(id); send(204); return
  }
  throw new ApiError('not_found', 'Endpoint não encontrado.', 404)
}
