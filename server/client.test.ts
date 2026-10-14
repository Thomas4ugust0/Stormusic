import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

test('local frontend downloads actual audio, persists metadata and plays offline', async (t) => {
  const dir = await mkdtemp(resolve(tmpdir(), 'stormusic-client-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const name of ['stream', 'offline', 'taste', 'data', 'supermix']) {
    let source = await readFile(`src/lib/${name}.ts`, 'utf8')
    source = source.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'").replace('import.meta.env.BASE_URL', "'/'").replace('import.meta.env.PROD', 'true')
    const out = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } })
    await writeFile(resolve(dir, name + '.mjs'), out.outputText)
  }
  const storage = new Map<string, string>()
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, val: string) => storage.set(key, val), removeItem: (key: string) => storage.delete(key) }, location: { hostname: 'localhost', protocol: 'http:', origin: 'http://localhost:8787' } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, storage: { persist: async () => true, persisted: async () => true, estimate: async () => ({ usage: 0, quota: 1e9 }) } } })
  const cacheStores = new Map<string, Map<string, Response>>()
  Object.assign(globalThis, { caches: { keys: async () => [...cacheStores.keys()], delete: async (key: string) => cacheStores.delete(key), open: async (key: string) => {
    if (!cacheStores.has(key)) cacheStores.set(key, new Map())
    const entries = cacheStores.get(key)!
    return { match: async (url: string) => entries.get(url)?.clone(), put: async (url: string, response: Response) => { entries.set(url, response.clone()) }, keys: async () => [...entries.keys()], delete: async (url: string) => entries.delete(url) }
  } } })
  let network = true; let failingId = ''; const calls: string[] = []
  globalThis.fetch = (async (url: string) => {
    calls.push(url)
    if (!network) throw new TypeError('Failed to fetch')
    if (failingId && url.includes(failingId)) return Response.json({ error: { message: 'Faixa recusada' } }, { status: 502 })
    if (url.startsWith('/api/resolve/')) return Response.json({ url: '/api/audio?id=' + url.split('/').at(-1), source: 'yt-dlp local', duration: 123 })
    if (url.startsWith('/api/audio')) return new Response('audio bytes', { headers: { 'content-type': 'audio/mp4' } })
    if (url.startsWith('https://i.ytimg.com')) return new Response('cover', { headers: { 'content-type': 'image/jpeg' } })
    if (url.startsWith('/api/v1/audio/')) return Response.json({ results: [{ id: 'abcdefghijk', title: 'Song', artist: 'Artist' }] })
    throw new Error('Unexpected non-local call: ' + url)
  }) as typeof fetch
  const stream = await import(pathToFileURL(resolve(dir, 'stream.mjs')).href)
  const offline = await import(pathToFileURL(resolve(dir, 'offline.mjs')).href)
  const taste = await import(pathToFileURL(resolve(dir, 'taste.mjs')).href)
  const track = { id: 'yt:abcdefghijk', ytId: 'abcdefghijk', title: 'Song', artist: 'Artist', sub: 'Album', genre: 'yt', moods: [], energy: 0.5, dur: 0 }
  const mix = { at: 100, tracks: [track], kinds: {}, online: true }
  assert.equal((await stream.searchMusic('Artist')).length, 1)
  assert.equal((await stream.relatedMusic('abcdefghijk')).length, 1)
  await stream.resolveAudio('abcdefghijk', 0, true)
  await offline.downloadMix(mix, () => {})
  assert.equal(offline.offlineState().ids.length, 1)
  assert.equal(taste.knownDuration(track.ytId), 123)
  assert.equal(offline.offlineTracks()[0].dur, 123)
  assert.equal(cacheStores.get('thumbs')?.size, 2)
  assert.ok(calls.some((u) => u === '/api/audio?id=abcdefghijk'))
  network = false
  const before = calls.length
  const r = await stream.resolveAudio('abcdefghijk', 0, true)
  assert.equal(r.source, 'Offline'); assert.ok(r.url.startsWith('blob:')); assert.equal(calls.length, before)
  await assert.rejects(stream.resolveAudio('23456789012', 0, true), /Servidor parado/)
  network = true; failingId = '23456789012'
  await assert.rejects(offline.downloadMix({ ...mix, at: 200, tracks: [track, { ...track, ytId: failingId }] }, () => {}), /mix anterior foi preservado/)
  assert.equal(offline.offlineState().at, 100)
  assert.ok(cacheStores.has('mix-100'))
  failingId = ''
  await offline.downloadMix({ ...mix, at: 200, tracks: [track, { ...track, ytId: '23456789012' }] }, () => {})
  assert.equal(offline.offlineState().ids.length, 2)
  assert.equal(cacheStores.has('mix-100'), false)
})
