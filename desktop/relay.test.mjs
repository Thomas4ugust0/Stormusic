import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { accessHeader, startRelay } from './relay.mjs'

test('desktop serves its own UI and library with a session token', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stormusic-desktop-'))
  let relay
  try {
    await writeFile(join(directory, 'index.html'), '<title>Stormusic</title>')
    relay = await startRelay({
      webDir: directory,
      serverDir: fileURLToPath(new URL('../server', import.meta.url)),
      stateDir: join(directory, 'engine'),
      port: 0,
      schedule: false,
    })
    const request = (path, init) => fetch(relay.origin + path, init)
    const headers = { [accessHeader]: relay.token }

    assert.equal((await request('/')).status, 403)
    assert.equal((await request('/api/v1/library')).status, 403)
    const page = await request('/', { headers })
    assert.equal(await page.text(), '<title>Stormusic</title>')
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/)
    const library = await request('/api/v1/library', { headers })
    assert.equal(library.status, 200)
    assert.deepEqual((await library.json()).tracks, [])
    assert.equal((await request('/api/admin/update-app', {
      method: 'POST',
      headers: { ...headers, 'x-stormusic': '1', 'sec-fetch-site': 'same-origin' },
    })).status, 403)
  } finally {
    if (relay) await new Promise(resolve => relay.server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
