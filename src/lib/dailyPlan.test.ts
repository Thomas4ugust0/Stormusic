import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPlan } from './dailyPlan.ts'
import type { Track } from './data'
const tracks = (count: number, duration = 300, offset = 0): Track[] => Array.from({ length: count }, (_, i) => ({ id: `t${i + offset}`, ytId: String(i + offset).padStart(11, '0'), title: 'Faixa', artist: 'Artista', dur: duration, sub: '', genre: '', moods: [], energy: 0 }))
test('25 five-minute tracks cover target; three-minute tracks expand to 40 without duplicates', () => {
  for (const [duration, count] of [[300, 25], [180, 40]]) {
    const candidates = tracks(60, duration)
    const result = buildPlan({ previous: null, events: [], candidates: [...candidates, ...candidates], now: 100 })
    assert.equal(result.tracks.length, count)
    assert.equal(new Set(result.tracks.map(t => t.ytId)).size, count)
    assert.ok(result.tracks.reduce((n, t) => n + t.dur, 0) >= 7200)
    assert.equal(candidates.length, 60)
  }
})
test('keeps twelve unheard tracks and replaces ten heard plus three skipped', () => {
  const previous = { at: 100, tracks: tracks(25) }
  const events = previous.tracks.slice(0, 13).map((t, i) => ({ y: t.ytId, k: i < 10 ? 'listen' : 'skip', at: 200 }))
  const result = buildPlan({ previous, events, candidates: tracks(60), now: 300 })
  assert.equal(result.tracks.length, 25)
  assert.deepEqual(result.tracks.slice(0, 12).map(t => t.ytId), previous.tracks.slice(13).map(t => t.ytId))
  assert.ok(result.tracks.every(t => !events.some(e => e.y === t.ytId)))
  assert.equal(previous.tracks.length, 25)
})
test('carried tracks must respect recent plays even when the event predates the plan', () => {
  const candidates = tracks(3)
  const result = buildPlan({ previous: { at: 100, tracks: candidates }, events: [{ y: candidates[0].ytId, k: 'skip', at: 50 }], candidates: [], now: 200 })
  assert.equal(result.tracks.length, 2)
  assert.equal(result.tracks.reduce((n, t) => n + t.dur, 0), 600)
})

test('repeat interval covers all 1–10 day settings, boundary and excluded/disliked tracks', () => {
  const pool = tracks(4), day = 86400000, now = 20 * day
  for (let days = 1; days <= 10; days++) {
    const events = [{y: pool[0].ytId, k: 'listen', at: now - days * day + 1}, {y: pool[1].ytId, k: 'skip', at: now - days * day}, {y: pool[2].ytId, k: 'dislike', at: 1}]
    const result = buildPlan({previous: {at: now - 1, tracks: pool}, candidates: pool, events, now, repeatDays: days, excludedIds: [pool[3].ytId]})
    assert.deepEqual(result.tracks.map(t => t.ytId), [pool[1].ytId])
  }
})
test('empty eligible pool remains empty; future events do not block tracks', () => {
  const pool = tracks(1), now = 1000
  assert.equal(buildPlan({previous: null, candidates: pool, events: [{y:pool[0].ytId,k:'listen',at:now}],now}).tracks.length, 0)
  assert.equal(buildPlan({previous: null, candidates: pool, events: [{y:pool[0].ytId,k:'listen',at:now+1}],now}).tracks.length, 1)
})
