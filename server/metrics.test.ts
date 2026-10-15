import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { requestMetric, noteCache, noteExtraction, flushMetrics } from './metrics.ts'

test('metrics isolate concurrent requests, count body bytes and finish only once', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'stormusic-metrics-'))
  process.env.RELAY_STATE_DIR = dir
  try {
    let now = 0
    const response = () => Object.assign(new EventEmitter(), { headersSent: true, statusCode: 206, writableFinished: true })
    const a = response(); const b = response()
    const request = (purpose: string) => ({ headers: { 'x-stormusic-purpose': purpose, authorization: 'secret-value', range: 'bytes=0-3' } }) as unknown as IncomingMessage
    const first = requestMetric(request('download'), a as unknown as ServerResponse, '9bZkp7q19f0', 'audio', () => now)
    const second = requestMetric(request('secret-value'), b as unknown as ServerResponse, 'abcdefghijk', 'resolve', () => now)
    await Promise.all([
      first.resolve(async () => { await Promise.resolve(); noteCache('miss'); noteExtraction(5, 10, null) }),
      second.resolve(async () => { await Promise.resolve(); noteCache('hit') }),
    ])
    now = 20; first.chunk(3)
    now = 30; first.chunk(1); first.renewed()
    now = 40; a.emit('finish'); a.emit('close')
    b.writableFinished = false; second.error('extract_timeout'); second.error('generic_error'); b.emit('close')
    await flushMetrics()
    const raw = await readFile(resolve(dir, 'metrics.jsonl'), 'utf8')
    assert.ok(!raw.includes('secret-value'))
    const rows = raw.trim().split('\n').map(line => JSON.parse(line))
    assert.equal(rows.length, 4)
    const done = rows.filter(r => r.stage === 'finished')
    assert.equal(done[0].bytes, 4); assert.equal(done[0].first_byte_ms, 20)
    assert.equal(done[0].download_ms, 40); assert.equal(done[0].type, 'download')
    assert.equal(done[0].queue_ms, 5); assert.equal(done[0].extract_ms, 10)
    assert.equal(done[0].cache, 'miss'); assert.equal(done[0].renewed, true)
    assert.equal(done[1].cache, 'hit'); assert.equal(done[1].extract_count, 0)
    assert.equal(done[1].type, 'play'); assert.equal(done[1].error, 'extract_timeout')
    assert.equal(done[1].first_byte_ms, null)
    const blocked = resolve(dir, 'not-a-directory'); await writeFile(blocked, '')
    process.env.RELAY_STATE_DIR = blocked
    const c = response()
    requestMetric(request('prefetch'), c as unknown as ServerResponse, 'abcdefghijk', 'resolve')
    c.emit('finish')
    await flushMetrics() // Logging failure must not reject a successful response.
  } finally { await flushMetrics(); await rm(dir, { recursive: true, force: true }) }
})
