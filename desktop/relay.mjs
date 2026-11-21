import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const accessHeader = 'X-Stormusic-Desktop'
const host = '127.0.0.1'
const policy = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' https://i.ytimg.com https://lrclib.net",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ')

export async function startRelay({ serverDir, webDir, stateDir, extractor, node, port = 38277, schedule = true }) {
  process.env.RELAY_STATE_DIR = stateDir
  process.env.RELAY_RESOLVER = 'spawn'
  if (extractor) process.env.YTDLP_PATH = extractor
  if (node) process.env.STORMUSIC_NODE = node
  const { createApp } = await import(pathToFileURL(join(serverDir, 'standalone.ts')).href)
  const token = randomBytes(32).toString('hex')
  const server = createApp(webDir, (req, res) => {
    if (req.headers.host !== `${host}:${server.address()?.port}` || req.headers[accessHeader.toLowerCase()] !== token) return false
    if (req.method !== 'GET' && new URL(req.url ?? '/', `http://${host}`).pathname.startsWith('/api/admin/')) return false
    res.setHeader('Content-Security-Policy', policy)
    return true
  })

  const listening = once(server, 'listening')
  server.listen(port, host)
  await listening
  if (schedule) {
    const { startScheduler } = await import(pathToFileURL(join(serverDir, 'scheduler.ts')).href)
    void startScheduler()
  }
  return { server, token, origin: `http://${host}:${server.address().port}` }
}
