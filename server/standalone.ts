// Run the relay outside Vite, e.g. on your home PC or on Android via Termux:
//   pkg install nodejs yt-dlp   (Termux)  |  pip install yt-dlp  (PC)
//   node --experimental-strip-types server/standalone.ts
// Then in the app: Biblioteca -> Servidor de stream -> http://<ip>:8787
import { createServer } from 'node:http'
import { handler } from './relay.ts'

const port = Number(process.env.RELAY_PORT || 8787)
createServer((req, res) => handler(req as never, res as never, () => { res.statusCode = 404; res.end('not found') })).listen(port, '0.0.0.0', () => console.log(`stream relay on :${port}`))
