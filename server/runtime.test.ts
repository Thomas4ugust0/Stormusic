import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

test('bounded extraction concurrency, hourly budget, LRU and error classification', async (t) => {
  const dir = await mkdtemp(resolve(tmpdir(), 'stormusic-runtime-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const fake = resolve(dir, 'extract.mjs'); const state = resolve(dir, 'active.json')
  await writeFile(state, JSON.stringify({ active: 0, max: 0 }))
  await writeFile(fake, `import fs from 'node:fs'; const p=process.env.ACTIVE_FILE; const read=()=>JSON.parse(fs.readFileSync(p)); let s=read(); s.active++; s.max=Math.max(s.max,s.active); fs.writeFileSync(p,JSON.stringify(s)); await new Promise(r=>setTimeout(r,50)); s=read(); s.active--; fs.writeFileSync(p,JSON.stringify(s)); console.log('{}')`)
  Object.assign(process.env, { YTDLP_PATH: fake, RELAY_CONCURRENCY: '1', RELAY_MAX_RESOLVES_PER_HOUR: '3', ACTIVE_FILE: state })
  const { extract, Lru, mapError } = await import('./runtime.ts')
  await Promise.all([extract([]), extract([]), extract([])])
  assert.equal(JSON.parse(await readFile(state, 'utf8')).max, 1)
  await assert.rejects(extract([]), (e: any) => e.code === 'rate_limited' && e.status === 429)
  const cache = new Lru<number>()
  for (let i = 0; i < 200; i++) cache.set(String(i), i, Date.now() + 10000)
  cache.get('0'); cache.set('200', 200, Date.now() + 10000)
  assert.equal(cache.get('1'), undefined); assert.equal(cache.get('0'), 0)
  cache.set('expired', 1, Date.now() - 1); assert.equal(cache.get('expired'), undefined)
  for (const [message, code] of [['Sign in to confirm you are not a bot', 'source_blocked'], ['Private video', 'video_private'], ['Confirm your age', 'video_age_restricted'], ['This live event will begin soon', 'live_not_supported'], ['Unable to extract signature', 'extractor_outdated']]) assert.equal(mapError(new Error(message)).code, code)
})
