import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadVerified } from './tool-download.mjs'

test('only a verified download becomes usable and is reused offline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stormusic-download-'))
  const destination = join(directory, 'engine', 'tool.exe')
  const bytes = Buffer.from('Stormusic test fixture')
  const server = createServer((_req, res) => res.end(bytes))
  const listening = once(server, 'listening')
  server.listen(0, '127.0.0.1')
  await listening

  try {
    const url = `http://127.0.0.1:${server.address().port}/tool.exe`
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await assert.rejects(downloadVerified({ url, sha256: 'wrong' }, destination), /SHA-256 inválido/)
    await assert.rejects(readFile(destination), { code: 'ENOENT' })

    await downloadVerified({ url, sha256 }, destination)
    assert.deepEqual(await readFile(destination), bytes)
    await new Promise(resolve => server.close(resolve))
    await downloadVerified({ url, sha256 }, destination)
    assert.deepEqual(await readFile(destination), bytes)
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
