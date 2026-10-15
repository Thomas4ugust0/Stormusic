import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ApiError } from './runtime.ts'

test('persistent library, downloader and protected API', async t => {
  const dir = await mkdtemp(resolve(tmpdir(), 'stormusic-library-'))
  process.env.RELAY_STATE_DIR = dir
  const { library, audioPath, snapshot, removeTrack, saveLibrary } = await import('./library.ts')
  const { savePlan } = await import('./planner.ts')
  const { runDownloads } = await import('./downloads.ts')
  const { createApp } = await import('./standalone.ts')
  const state = await library()
  const app = createApp(dir)
  await new Promise<void>(done => app.listen(0, '127.0.0.1', done))
  const address = app.address() as { port: number }, base = `http://127.0.0.1:${address.port}`
  t.after(async () => { app.closeAllConnections(); await new Promise<void>(done => app.close(() => done())); await rm(dir, { recursive: true, force: true }) })
  let now = Date.now(), calls = 0
  const id = (n: number) => String(n).padStart(11, '0')
  const plan = (count: number, offset: number) => ({ tracks: Array.from({ length: count }, (_, i) => ({ id: id(offset + i), title: 'Song', artist: 'Artist', duration: 300 })) })
  const source = async (video: string) => ({ url: `https://fixture.invalid/audio?id=${video}&itag=140&clen=10&lmt=1`, expires: now + 5 * 3600000, source: 'fixture', mime: 'audio/mp4', bitrate: 128000, duration: 300 })
  const starts: number[] = []
  const network: typeof fetch = async (_url, init) => {
    starts.push(now); calls++
    const start = Number(new Headers(init?.headers).get('range')!.match(/\d+/)![0])
    return new Response('0123456789'.slice(start), { status: 206, headers: { 'content-range': `bytes ${start}-9/10`, 'content-length': String(10 - start) } })
  }
  const dependencies = { clock: () => now, random: () => 0, wait: async (ms: number) => { now += ms }, resolve: source, fetch: network }
  const reset = async (count: number, offset: number) => { state.tracks = []; state.pauseUntil = 0; state.pauses = 0; state.blocked = 0; await savePlan(plan(count, offset)) }
  await t.test('25 tracks persist, respect pacing and serve exact disk Range without extractor', async () => {
    await reset(25, 100)
    await runDownloads(0, true, dependencies)
    assert.equal(state.lastRunStatus, 'concluído'); assert.equal(calls, 25)
    assert.ok(starts.slice(1).every((time, i) => time - starts[i] >= 15000))
    const saved = JSON.parse(await readFile(resolve(dir, 'library.json'), 'utf8'))
    assert.equal(saved.tracks.filter((track: { status: string }) => track.status === 'done').length, 25)
    assert.equal((await snapshot()).summary.minutes, 125)
    const response = await fetch(base + '/api/audio?id=' + id(100), { headers: { Range: 'bytes=2-5' } })
    assert.equal(response.status, 206); assert.equal(response.headers.get('x-stormusic-source'), 'disk')
    assert.equal(response.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await response.text(), '2345')
    const suffix = await fetch(base + '/api/audio?id=' + id(100), { headers: { Range: 'bytes=-3' } })
    assert.equal(await suffix.text(), '789')
    const invalid = await fetch(base + '/api/audio?id=' + id(100), { headers: { Range: 'bytes=100-' } })
    assert.equal(invalid.status, 416)
  })
  await t.test('mutation requires both same-origin headers; metadata and request size are bounded', async () => {
    for (const headers of [{}, { 'X-Stormusic': '1' }, { 'Sec-Fetch-Site': 'same-origin' }]) {
      assert.equal((await fetch(base + '/api/v1/plan', { method: 'PUT', headers, body: JSON.stringify(plan(1, 200)) })).status, 403)
    }
    const headers = { 'X-Stormusic': '1', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }
    for (const value of [{ tracks: [] }, plan(61, 200), { tracks: [{ ...plan(1, 200).tracks[0], id: '../bad' }] }, { tracks: [plan(1, 200).tracks[0], plan(1, 200).tracks[0]] }]) {
      assert.equal((await fetch(base + '/api/v1/plan', { method: 'PUT', headers, body: JSON.stringify(value) })).status, 400)
    }
    const valid = await fetch(base + '/api/v1/plan', { method: 'PUT', headers, body: JSON.stringify(plan(2, 200)) })
    assert.deepEqual(await valid.json(), { accepted: 2, missing: 2 })
    assert.equal((await fetch(base + '/api/v1/prefetch', { method: 'POST', headers, body: JSON.stringify({ ids: Array(6).fill(id(200)) }) })).status, 400)
    const large = await fetch(base + '/api/v1/plan', { method: 'PUT', headers, body: JSON.stringify({ tracks: [], extra: 'a'.repeat(66000) }) })
    assert.equal(large.status, 413)
  })
  await t.test('three source blocks pause thirty minutes, maximum three pauses, then partial', async () => {
    await reset(1, 300); const pauses: number[] = []; let previous = now
    await runDownloads(0, true, { ...dependencies, fetch: async () => { pauses.push(now - previous); previous = now; return new Response(null, { status: 403 }) } })
    assert.equal(state.pauses, 3); assert.equal(pauses.length, 12)
    assert.equal(pauses.filter(ms => ms >= 30 * 60000).length, 3)
    assert.match(state.lastRunStatus, /parcial/); assert.equal(state.running, false)
  })
  await t.test('deadline prevents queued downloads from starting after 07:00', async () => {
    await reset(2, 400); const before = calls
    await runDownloads(now + 10000, true, dependencies)
    assert.equal(calls - before, 1); assert.equal(state.lastRunStatus, 'parcial')
    assert.equal(state.tracks[1].status, 'queued')
  })
  await t.test('pacing leaves fifteen seconds after a slow file finishes, not just between starts', async () => {
    await reset(2, 450)
    const transfers: { start: number; end: number }[] = []
    await runDownloads(0, true, { ...dependencies, fetch: async (url, init) => {
      const start = now; now += 20000
      transfers.push({ start, end: now }); return network(url, init)
    } })
    assert.equal(transfers.length, 2)
    assert.ok(transfers[1].start - transfers[0].end >= 15000)
  })
  await t.test('truncated media resumes after an actual Node restart without storing signed URLs', async () => {
    await reset(1, 500); let attempts = 0
    await runDownloads(0, true, { ...dependencies, fetch: async () => {
      if (attempts++) throw new ApiError('stop', 'fixture stop', 500, false)
      return new Response('01234', { status: 206, headers: { 'content-range': 'bytes 0-9/10', 'content-length': '10' } })
    } })
    assert.equal(await readFile(audioPath(id(500), true), 'utf8'), '01234')
    const saved = await readFile(resolve(dir, 'library.json'), 'utf8')
    assert.ok(!saved.includes('https://')); assert.ok(!saved.includes('fixture.invalid'))
    const runner = resolve(dir, 'resume.mjs')
    await writeFile(runner, `import { runDownloads } from ${JSON.stringify(pathToFileURL(resolve('server/downloads.ts')).href)};
      let range;
      await runDownloads(0, true, {clock:()=>${now}, random:()=>0, wait:async()=>{}, resolve:async()=>(${JSON.stringify(await source(id(500)))}), fetch:async(_u,init)=>{range=init.headers.Range;return new Response('56789',{status:206,headers:{'content-range':'bytes 5-9/10','content-length':'5'}})}});
      if(range!=='bytes=5-') throw Error('partial not resumed: '+range);`)
    await promisify(execFile)(process.execPath, [runner], { env: { ...process.env, RELAY_STATE_DIR: dir }, timeout: 10000 })
    assert.equal(await readFile(audioPath(id(500)), 'utf8'), '0123456789')
    assert.equal(JSON.parse(await readFile(resolve(dir, 'library.json'), 'utf8')).tracks[0].status, 'done')
  })
  await t.test('removal preserves a recoverable file and metadata backup', async () => {
    await reset(1, 600); await runDownloads(0, true, dependencies)
    await removeTrack(id(600))
    assert.equal(state.tracks[0].removed, true)
    const backups = await readdir(resolve(dir, 'backups'))
    assert.equal(backups.length, 1)
    assert.equal(await readFile(resolve(dir, 'backups', backups[0], id(600) + '.m4a'), 'utf8'), '0123456789')
    assert.equal(JSON.parse(await readFile(resolve(dir, 'backups', backups[0], 'track.json'), 'utf8')).id, id(600))
    await assert.rejects(readFile(audioPath(id(600))))
    await saveLibrary()
  })
  await t.test('optional two-worker mode never shares a track or exceeds two transfers', async () => {
    await reset(5, 700)
    process.env.RELAY_DOWNLOAD_CONCURRENCY = '2'
    let active = 0, peak = 0
    const ids: string[] = []
    try {
      await runDownloads(0, true, { ...dependencies, fetch: async (url, init) => {
        active++; peak = Math.max(peak, active); ids.push(new URL(String(url)).searchParams.get('id')!)
        try { await new Promise(done => setImmediate(done)); return await network(url, init) }
        finally { active-- }
      } })
      assert.equal(ids.length, 5); assert.equal(new Set(ids).size, 5)
      assert.ok(peak <= 2); assert.equal(state.tracks.filter(track => track.status === 'done').length, 5)
    } finally { delete process.env.RELAY_DOWNLOAD_CONCURRENCY }
  })
})
