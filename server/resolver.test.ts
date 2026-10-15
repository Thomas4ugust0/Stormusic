import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { createResolver } from './resolver.ts'

test('resident worker deduplicates, prioritizes play, expires cache and recovers after crash/timeout', async t => {
  delete process.env.RELAY_RESOLVER
  let processes = 0, now = Date.now()
  const requests: string[] = []
  const resolver = createResolver({ clock: () => now, timeoutMs: 500, workerFactory: () => {
    processes++
    const child = spawn(process.execPath, [resolve('server/fixtures/worker.mjs')], { windowsHide: true, stdio: 'pipe' })
    child.stdout.on('data', chunk => { for (const line of chunk.toString().trim().split('\n')) requests.push(JSON.parse(line).result.url.split('/').at(-1)) })
    return child
  } })
  t.after(() => resolver.resetResolver())
  const slow = resolver.resolveTrack('slow0000000')
  const download = resolver.resolveTrack('download000', 'download')
  const prefetch = resolver.resolveTrack('prefetch000', 'prefetch')
  const play = resolver.resolveTrack('play0000000', 'play')
  assert.equal(resolver.resolveTrack('download000', 'download'), download)
  await Promise.all([slow, download, prefetch, play])
  assert.deepEqual(requests, ['slow0000000', 'play0000000', 'prefetch000', 'download000'])
  assert.equal(processes, 1)
  await resolver.resolveTrack('play0000000'); assert.equal(requests.length, 4)
  now += 5 * 3600000 + 1
  await resolver.resolveTrack('play0000000'); assert.equal(requests.length, 5)
  await assert.rejects(resolver.resolveTrack('crash000000'), { code: 'extractor_outdated' })
  await resolver.resolveTrack('aftercrash0'); assert.equal(processes, 2)
  await assert.rejects(resolver.resolveTrack('timeout0000'), { code: 'extract_timeout' })
  await resolver.resolveTrack('aftertimer0'); assert.equal(processes, 3)
})
