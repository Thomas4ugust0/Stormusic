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
  for (const name of ['stream', 'offline', 'taste', 'data', 'supermix', 'safety']) {
    let source = await readFile(`src/lib/${name}.ts`, 'utf8')
    source = source.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'").replace('import.meta.env.BASE_URL', "'/'").replace('import.meta.env.PROD', 'true')
    const out = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } })
    await writeFile(resolve(dir, name + '.mjs'), out.outputText)
  }
  const storage = new Map<string, string>()
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, val: string) => storage.set(key, val), removeItem: (key: string) => storage.delete(key) }, location: { hostname: 'localhost', protocol: 'http:', origin: 'http://localhost:8787' } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, storage: { persist: async () => true, persisted: async () => true, estimate: async () => ({ usage: 0, quota: 1e9 }) } } })
  const cacheStores = new Map<string, Map<string, Response>>()
  let backupQuotaFailure = false
  Object.assign(globalThis, { caches: { keys: async () => [...cacheStores.keys()], delete: async (key: string) => cacheStores.delete(key), open: async (key: string) => {
    if (!cacheStores.has(key)) cacheStores.set(key, new Map())
    const entries = cacheStores.get(key)!
    return { match: async (url: string) => entries.get(url)?.clone(), put: async (url: string, response: Response) => { if (backupQuotaFailure && key.startsWith('stormusic-backup-')) throw new Error('QuotaExceededError'); entries.set(url, response.clone()) }, keys: async () => [...entries.keys()], delete: async (url: string) => entries.delete(url) }
  } } })
  let network = true; let failingId = ''; let coverFailure = false; const calls: string[] = []
  let audioReply = () => new Response('audio bytes', { status: 206, headers: { 'content-type': 'audio/mp4', 'content-range': 'bytes 0-10/11', 'content-length': '11' } })
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push(url)
    if (!network) throw new TypeError('Failed to fetch')
    if (failingId && url.includes(failingId)) return Response.json({ error: { message: 'Faixa recusada' } }, { status: 502 })
    if (url.startsWith('/api/resolve/')) return Response.json({ url: '/api/audio?id=' + url.split('/').at(-1), source: 'yt-dlp local', duration: 123 })
    if (url.startsWith('/api/audio')) {
      assert.equal(new Headers(init?.headers).get('range'), 'bytes=0-')
      assert.equal(new Headers(init?.headers).get('x-stormusic-purpose'), 'download')
      return audioReply()
    }
    if (url.startsWith('https://i.ytimg.com')) {
      if (coverFailure) throw new TypeError('Cover unavailable')
      return new Response('cover', { headers: { 'content-type': 'image/jpeg' } })
    }
    if (url.startsWith('/api/v1/audio/')) return Response.json({ results: [{ id: 'abcdefghijk', title: 'Song', artist: 'Artist' }] })
    throw new Error('Unexpected non-local call: ' + url)
  }) as typeof fetch
  const stream = await import(pathToFileURL(resolve(dir, 'stream.mjs')).href)
  const offline = await import(pathToFileURL(resolve(dir, 'offline.mjs')).href)
  const taste = await import(pathToFileURL(resolve(dir, 'taste.mjs')).href)
  const safety = await import(pathToFileURL(resolve(dir, 'safety.mjs')).href)
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
  assert.equal(cacheStores.has('mix-100'), true)
  await t.test('download rejects partial, malformed and truncated responses', async () => {
    const fullReply = audioReply
    for (const range of ['bytes 0-3/11', 'bytes 1-10/11', 'bytes 0-10/*', 'invalid', 'bytes 0-10/9007199254740992']) {
      audioReply = () => new Response('part', { status: 206, headers: { 'content-type': 'audio/mp4', 'content-range': range } })
      await assert.rejects(stream.fetchAudioBlob('abcdefghijk'), /parte do áudio/)
    }
    audioReply = () => new Response('short', { status: 206, headers: { 'content-type': 'audio/mp4', 'content-range': 'bytes 0-10/11', 'content-length': '11' } })
    await assert.rejects(stream.fetchAudioBlob('abcdefghijk'), /Download incompleto/)
    audioReply = () => new Response('audio bytes', { status: 206, headers: { 'content-type': 'audio/mp4', 'content-range': 'bytes 0-10/11', 'content-length': '12' } })
    await assert.rejects(stream.fetchAudioBlob('abcdefghijk'), /tamanho informado/)
    audioReply = fullReply
  })
  await t.test('complete HTTP 200 remains compatible; interrupted body fails', async () => {
    const fullReply = audioReply
    audioReply = () => new Response('audio bytes', { headers: { 'content-type': 'audio/mp4', 'content-length': '11' } })
    assert.equal((await stream.fetchAudioBlob('abcdefghijk')).size, 11)
    audioReply = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.error(new Error('upstream interrupted')) } }), { headers: { 'content-type': 'audio/mp4' } })
    await assert.rejects(stream.fetchAudioBlob('abcdefghijk'), /upstream interrupted/)
    audioReply = fullReply
  })
  await t.test('cover failure cannot discard downloaded audio or trigger audio retry', async () => {
    coverFailure = true
    const id = '98765432101'
    await offline.downloadMix({ ...mix, at: 300, tracks: [{ ...track, ytId: id }] }, () => {})
    assert.deepEqual(offline.offlineState().ids, [id])
    assert.equal(calls.filter(u => u === '/api/audio?id=' + id).length, 1)
    assert.equal(await cacheStores.get('mix-300')!.get('/offline/' + id)!.clone().text(), 'audio bytes')
    network = false
    assert.ok((await offline.offlineUrl(id)).startsWith('blob:'))
    network = true; coverFailure = false
  })
  await t.test('partial audio never replaces a working offline mix', async () => {
    audioReply = () => new Response('part', { status: 206, headers: { 'content-type': 'audio/mp4', 'content-range': 'bytes 0-3/11' } })
    await assert.rejects(offline.downloadMix({ ...mix, at: 400 }, () => {}), /Nenhuma faixa/)
    assert.equal(offline.offlineState().at, 300)
    assert.ok(cacheStores.has('mix-300'))
    assert.equal(cacheStores.has('mix-400'), false)
  })
  await t.test('confirmed taste reset backs up only taste data and restores within seven days', async () => {
    const now = 2_000_000_000_000
    storage.set('ytm.profile', JSON.stringify({ genres: ['rock'], subs: [], artists: ['Artist'] }))
    storage.set('ytm.fb', JSON.stringify({ liked: [track.id], disliked: [], played: [] }))
    storage.set('unrelated', 'preserve'); storage.set('ytm.audioflow', 'private-config')
    taste.record(track, 'like')
    const previousTaste = storage.get('ytm.taste')
    await assert.rejects(safety.safeReset('taste', false, now), /Confirme/)
    assert.equal(storage.get('ytm.taste'), previousTaste)
    await safety.safeReset('taste', true, now)
    assert.equal(taste.isLiked(track.ytId), false)
    assert.equal(storage.get('unrelated'), 'preserve')
    assert.equal(storage.get('ytm.audioflow'), 'private-config')
    assert.ok(!storage.get('ytm.backup')!.includes('private-config'))
    assert.equal(offline.offlineState().at, 300)
    assert.equal(safety.hasBackup(now + 7 * 86400_000 - 1), true)
    assert.equal(safety.hasBackup(now + 7 * 86400_000), false)
    assert.throws(() => safety.restoreTaste(now + 7 * 86400_000), /sete dias/)
    safety.restoreTaste(now + 1)
    assert.equal(storage.get('ytm.taste'), previousTaste)
    assert.equal(taste.isLiked(track.ytId), true)
  })
  await t.test('unlike undo removes only its signal and preserves subsequent listening', () => {
    const undo = taste.record(track, 'unlike')
    taste.record(track, 'listen')
    assert.equal(taste.isLiked(track.ytId), false)
    undo(); undo()
    assert.equal(taste.isLiked(track.ytId), true)
    assert.equal(JSON.parse(storage.get('ytm.taste')!).ev.at(-1).k, 'listen')
  })
  await t.test('backup storage failure prevents reset; invalid backups are refused', async () => {
    const original = localStorage.setItem
    const before = storage.get('ytm.taste')
    localStorage.setItem = (key, value) => { if (key === 'ytm.backup') throw new Error('QuotaExceededError'); original(key, value) }
    await assert.rejects(safety.safeReset('taste', true), /QuotaExceededError/)
    assert.equal(storage.get('ytm.taste'), before)
    localStorage.setItem = original
    const backup = storage.get('ytm.backup')!
    const malformed = JSON.parse(backup); malformed.values['ytm.fb'] = '{"liked":null}'
    storage.set('ytm.backup', JSON.stringify(malformed))
    assert.equal(safety.hasBackup(malformed.at), false)
    storage.set('ytm.backup', backup)
  })
  await t.test('download backup quota failure preserves originals; confirmed clear restores audio', async () => {
    const now = 2_000_000_000_000
    assert.deepEqual(await safety.downloadSummary(), { count: 3, bytes: 44 })
    backupQuotaFailure = true
    await assert.rejects(safety.safeReset('downloads', true, now), /QuotaExceededError/)
    assert.equal(offline.offlineState().at, 300)
    assert.ok(cacheStores.has('mix-300'))
    backupQuotaFailure = false
    await safety.safeReset('downloads', true, now)
    assert.equal(offline.offlineState(), null)
    assert.equal(cacheStores.has('mix-300'), false)
    assert.equal(safety.hasDownloadBackup(now + 1), true)
    await safety.restoreDownloads(now + 1)
    assert.equal(offline.offlineState().at, 300)
    assert.equal(await cacheStores.get('mix-300')!.get('/offline/98765432101')!.clone().text(), 'audio bytes')
    assert.ok((await offline.offlineUrl('98765432101')).startsWith('blob:'))
  })
  await t.test('taste weights, skip threshold and 21-day decay use the supplied clock', () => {
    const now = 2_000_000_000_000
    const metadata = { [track.ytId]: { title: 'Song', artist: 'Artist', dur: 123, sub: '' } }
    for (const [kind, weight] of Object.entries({ like: 4, unlike: -4, listen: 1, skip: -1, dislike: -6 })) {
      const current = taste.scoreTaste(null, [{ y: track.ytId, k: kind, at: now }], metadata, now)
      assert.equal(current.track.get(track.ytId), weight)
      const later = taste.scoreTaste(null, [{ y: track.ytId, k: kind, at: now }], metadata, now + 21 * 86400000)
      assert.equal(later.track.get(track.ytId), weight / 2)
      if (kind === 'listen' || kind === 'skip') assert.equal(current.artist.get('artist'), weight / 2)
    }
    storage.set('ytm.taste', JSON.stringify({ ev: [], meta: {} })); taste.reloadTaste()
    taste.recordPlayback(track, 0.99, false, now)
    assert.equal(taste.tasteEvents().length, 0)
    taste.recordPlayback(track, 1, false, now)
    taste.recordPlayback(track, 29.99, false, now)
    taste.recordPlayback(track, 30, false, now)
    taste.recordPlayback(track, 0.1, true, now)
    assert.deepEqual(taste.tasteEvents().map((e: { k: string }) => e.k), ['skip', 'skip', 'listen', 'listen'])
    assert.ok(taste.tasteEvents().every((e: { at: number }) => e.at === now))
  })
  await t.test('disk mirroring publishes each complete track and refuses truncated audio', async () => {
    Object.assign(globalThis, { window: { dispatchEvent: () => true } })
    localStorage.setItem('ytm.mirrorPaused', '0')
    const savedFetch = globalThis.fetch
    let complete = true
    globalThis.fetch = (async (url: string) => url.startsWith('/api/audio')
      ? new Response(complete ? 'audio bytes' : 'short', { headers: { 'x-stormusic-source': 'disk', 'content-type': 'audio/mp4' } }) : new Response('cover')) as typeof fetch
    try {
      const copied = { ...track, ytId: 'mirror00000', dur: 123 }
      await offline.mirrorLibrary([{ id: copied.ytId, status: 'done', bytes: 11 }], [copied], () => true)
      assert.ok(offline.offlineState().ids.includes(copied.ytId))
      assert.ok(offline.offlineTracks().some((t: { ytId: string }) => t.ytId === copied.ytId))
      complete = false
      const truncated = { ...copied, ytId: 'short000000' }
      await offline.mirrorLibrary([{ id: truncated.ytId, status: 'done', bytes: 11 }], [truncated], () => true)
      assert.ok(!offline.offlineState().ids.includes(truncated.ytId))
      await offline.removeCachedTrack(copied.ytId)
      assert.ok(!offline.offlineState().ids.includes(copied.ytId))
      assert.equal(await cacheStores.get('stormusic-backup-track-' + copied.ytId)!.get('/offline/' + copied.ytId)!.clone().text(), 'audio bytes')
    } finally { globalThis.fetch = savedFetch }
  })

})
