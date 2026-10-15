import { startScheduler } from './scheduler.ts'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat, realpath } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handler } from './relay.ts'
import { autoUpdate } from './admin.ts'

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' }
export function createApp(webDir = process.env.WEB_DIR || fileURLToPath(new URL('../dist', import.meta.url))) {
  const root = resolve(webDir)
  return createServer((req, res) => {
    const raw = req.url?.split('?')[0] || '/'
    let pathname: string
    try { pathname = decodeURIComponent(raw) } catch { res.writeHead(400); res.end(); return }
    if (pathname.includes(String.fromCharCode(0)) || pathname.includes(String.fromCharCode(92)) || pathname.split('/').some((part) => part === '..' || part.startsWith('.'))) { res.writeHead(403); res.end(); return }
    const host = req.headers.host?.split(':')[0]
    if (!['localhost', '127.0.0.1', process.env.RELAY_HOST].filter(Boolean).includes(host)) { res.writeHead(403); res.end(); return }
    void handler(req, res, () => { void (async () => {
      if (!['GET', 'HEAD'].includes(req.method || '') || /^\/(api|health)(\/|$)/.test(pathname)) { res.writeHead(404); res.end(); return }
      let file = resolve(root, '.' + pathname)
      if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403); res.end(); return }
      try {
        const info = await stat(file).catch(() => null)
        if (!info?.isFile()) {
          if (extname(pathname)) { res.writeHead(404); res.end(); return }
          file = resolve(root, 'index.html')
        }
        const actual = await realpath(file); const realRoot = await realpath(root)
        if (!actual.startsWith(realRoot + sep)) { res.writeHead(403); res.end(); return }
        res.setHeader('content-type', types[extname(file)] || 'application/octet-stream')
        res.setHeader('cache-control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
        res.setHeader('content-length', (await stat(file)).size)
        if (req.method === 'HEAD') { res.end(); return }
        const stream = createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res)
      } catch { res.writeHead(503); res.end('PWA ausente. Instale o pacote phone-dist ou execute pnpm build:phone no PC.') }
    })() })
  })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.RELAY_HOST || '127.0.0.1'
  const port = Number(process.env.RELAY_PORT || 8787)
  createApp().listen(port, host, () => {
    console.log('Stormusic: http://localhost:' + port)
    void autoUpdate()
    void startScheduler()
  })
}
