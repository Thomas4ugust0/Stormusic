import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'

test('local server contracts and protected updates', async (t) => {
  const dir = await mkdtemp(resolve(tmpdir(), 'stormusic-test-'))
  const stateFile = resolve(dir, 'fixture.json'); const logFile = resolve(dir, 'commands.jsonl')
  const fixture = resolve('server/fixtures/executable.mjs')
  Object.assign(process.env, { YTDLP_PATH: fixture, RELAY_PIP: fixture, RELAY_GIT: fixture, RELAY_STATE_DIR: dir, RELAY_APP_DIR: dir, RELAY_AUTO_UPDATE_DAYS: '0', FIXTURE_STATE: stateFile, FIXTURE_LOG: logFile })
  let rejectFirst = false; const requested: string[] = []
  const upstream = createServer((req, res) => {
    requested.push(req.url!)
    if (rejectFirst) { rejectFirst = false; res.writeHead(403); res.end(); return }
    const data = Buffer.from('0123456789')
    res.setHeader('content-type', 'audio/mp4'); res.setHeader('accept-ranges', 'bytes')
    if (req.headers.range) { res.writeHead(206, { 'content-range': 'bytes 0-3/10', 'content-length': 4 }); res.end(data.subarray(0, 4)) }
    else res.end(data)
  })
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
  const state = { upstream: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}` }
  await writeFile(stateFile, JSON.stringify(state)); await writeFile(logFile, '')
  const web = resolve(dir, 'dist'); await mkdir(resolve(web, 'assets'), { recursive: true })
  await writeFile(resolve(web, 'index.html'), '<main>Stormusic</main>')
  await writeFile(resolve(web, 'sw.js'), '// service worker')
  await writeFile(resolve(web, 'manifest.webmanifest'), '{}')
  await writeFile(resolve(web, 'assets/app.js'), '// app')
  await mkdir(resolve(dir, 'server')); await writeFile(resolve(dir, 'server/standalone.ts'), '// fixture')
  const { createApp } = await import('./standalone.ts')
  const { startUpdate, healthStatus } = await import('./admin.ts')
  const app = createApp(web)
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
  const mutate = async (changes: object) => writeFile(stateFile, JSON.stringify({ ...JSON.parse(await readFile(stateFile, 'utf8')), ...changes }))
  const waitUpdate = async () => { for (let i = 0; i < 100; i++) { const h = await healthStatus(); if (h.state !== 'running') return h; await new Promise((r) => setTimeout(r, 30)) } throw new Error('Update did not finish') }
  t.after(async () => { app.closeAllConnections(); upstream.closeAllConnections(); await Promise.all([new Promise<void>((r) => app.close(() => r())), new Promise<void>((r) => upstream.close(() => r()))]); await rm(dir, { recursive: true, force: true }) })
  await t.test('health and static PWA caching, SPA, missing API, traversal and rebinding', async () => {
    const h = await fetch(base + '/health'); assert.equal((await h.json()).ytdlp_version, '2026.01.01'); assert.equal(h.headers.get('access-control-allow-origin'), null)
    assert.match(await (await fetch(base + '/library')).text(), /Stormusic/)
    assert.equal((await fetch(base + '/api/absent')).status, 404)
    assert.equal((await fetch(base + '/assets/missing.js')).status, 404)
    assert.equal((await fetch(base + '/sw.js')).headers.get('cache-control'), 'no-cache')
    assert.match((await fetch(base + '/assets/app.js')).headers.get('cache-control')!, /immutable/)
    assert.equal((await fetch(base + '/manifest.webmanifest')).headers.get('content-type'), 'application/manifest+json')
    const raw = (path: string, host?: string) => new Promise<number>((done) => { const req = request(base + '/', { path, headers: host ? { host } : {} }, (res) => { res.resume(); done(res.statusCode!) }); req.end() })
    assert.equal(await raw('/%2e%2e/secret'), 403)
    assert.equal(await raw('/health', 'evil.example'), 403)
  })
  await t.test('resolve, complete file, Range and renewed URL after 403', async () => {
    const r = await (await fetch(base + '/api/resolve/9bZkp7q19f0')).json()
    assert.equal(r.source, 'yt-dlp local'); assert.equal(r.mime, 'audio/mp4'); assert.equal(r.duration, 123)
    const range = await fetch(base + r.url, { headers: { range: 'bytes=0-3' } })
    assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 0-3/10'); assert.equal(await range.text(), '0123')
    rejectFirst = true
    assert.equal(await (await fetch(base + r.url)).text(), '0123456789')
    assert.notEqual(requested.at(-1), requested.at(-2))
  })
  await t.test('search/related contracts, filtering, caching and fallback', async () => {
    const search = await (await fetch(base + '/api/v1/audio/search?q=artist&limit=5')).json()
    assert.equal(search.query, 'artist'); assert.equal(search.results.length, 4)
    assert.deepEqual(search.results[1], { id: 'abcdefghijk', title: 'Song', artist: 'Artist', album: 'Album', duration: 123 })
    const before = await readFile(logFile, 'utf8'); await fetch(base + '/api/v1/audio/search?q=artist&limit=5'); assert.equal(await readFile(logFile, 'utf8'), before)
    const related = await (await fetch(base + '/api/v1/audio/related?id=9bZkp7q19f0')).json()
    assert.ok(related.results.every((h: { id: string }) => h.id !== related.id))
    await mutate({ failPrimary: true })
    const fallback = await (await fetch(base + '/api/v1/audio/search?q=fallback')).json()
    assert.equal(fallback.results.length, 3)
    await mutate({ failPrimary: false })
  })
  await t.test('input and admin rejection before spawning commands', async () => {
    const before = await readFile(logFile, 'utf8')
    for (const path of ['/api/resolve/bad', '/api/audio?id=bad', '/api/v1/audio/search?q=x&limit=51', '/api/v1/audio/search?q=' + 'a'.repeat(201), '/api/v1/audio/related?id=bad']) assert.equal((await fetch(base + path)).status, 400)
    assert.equal((await fetch(base + '/api/admin/update-ytdlp', { method: 'POST' })).status, 403)
    assert.equal((await fetch(base + '/api/admin/update-app?command=bad', { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin', 'X-Stormusic': '1' } })).status, 400)
    assert.equal(await readFile(logFile, 'utf8'), before)
  })
  await t.test('yt-dlp update success, lock and verified rollback', async () => {
    // Node fetch sets Sec-Fetch-Site only when explicitly provided; browsers supply it themselves.
    const r = await fetch(base + '/api/admin/update-ytdlp', { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin', 'X-Stormusic': '1' } })
    assert.equal(r.status, 202)
    await assert.rejects(startUpdate('ytdlp'), /andamento/)
    assert.equal((await waitUpdate()).state, 'ok')
    await mutate({ failUpdate: true })
    await startUpdate('ytdlp')
    const h = await waitUpdate(); assert.equal(h.state, 'failed'); assert.match(h.message, /restauradas/); assert.equal(h.ytdlp_version, '2026.01.01')
  })
  await t.test('app update refuses dirty distribution and git failure', async () => {
    await mutate({ dirty: true }); await startUpdate('app', () => {}); assert.equal((await waitUpdate()).state, 'failed')
    await mutate({ dirty: false, failGit: true }); await startUpdate('app', () => {}); assert.equal((await waitUpdate()).state, 'failed')
  })
  await t.test('app update succeeds and requests restart', async () => {
    await mutate({ failGit: false }); let restarted = false
    await startUpdate('app', () => { restarted = true })
    assert.equal((await waitUpdate()).state, 'ok')
    await new Promise((r) => setTimeout(r, 800)); assert.equal(restarted, true)
  })
})
