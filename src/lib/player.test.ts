import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Player } from './player.ts'

class FakeAudio {
  preload = ''; src = ''; dataset: Record<string, string> = {}; paused = true; ended = false
  duration = 180; currentTime = 0; readyState = 4; plays = 0; reject = false
  onplaying?: () => void; onpause?: () => void; onwaiting?: () => void; ontimeupdate?: () => void; onended?: () => void
  async play() { this.plays++; if (this.reject) throw new Error('NotAllowedError'); this.paused = false; this.onplaying?.() }
  pause() { if (!this.paused) { this.paused = true; queueMicrotask(() => this.onpause?.()) } }
  load() {}
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }
const source = (url: string) => ({ url, source: 'fixture' })
test('adapter rejects stale loads, respects pause, and handles autoplay rejection and external pause', async t => {
  t.mock.method(globalThis, 'setTimeout', setTimeout)
  Object.assign(globalThis, { Audio: FakeAudio })
  const warnings: string[] = []
  const player = new Player({ state: () => {}, source: () => {}, time: () => {}, ended: () => {}, warning: message => warnings.push(message) })
  t.after(() => player.destroy())
  player.intent(true)
  const first = deferred<ReturnType<typeof source>>()
  const loading = player.load('first', () => first.promise)
  player.intent(false); first.resolve(source('first')); await loading
  assert.equal((player.audio as unknown as FakeAudio).plays, 0)
  const stale = deferred<ReturnType<typeof source>>()
  const old = player.load('old', () => stale.promise)
  await player.load('new', async () => source('new'))
  stale.resolve(source('old')); await old
  assert.equal(player.audio.src, 'new')
  const audio = player.audio as unknown as FakeAudio
  audio.reject = true; player.intent(true); await new Promise(done => setImmediate(done))
  assert.equal(player.state.wantPlay, false); assert.equal(player.state.status, 'paused'); assert.equal(warnings.length, 1)
  audio.reject = false; player.intent(true); await new Promise(done => setImmediate(done))
  assert.equal(player.state.status, 'playing')
  audio.pause(); await new Promise(done => setImmediate(done))
  assert.equal(player.state.wantPlay, false)
})
test('prepared audio swaps without resolving twice; waiting advance fires once and is cancelled by pause', async t => {
  Object.assign(globalThis, { Audio: FakeAudio })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let advances = 0
  const player = new Player({ state: () => {}, source: () => {}, time: () => {}, warning: () => {}, ended: () => advances++ })
  t.after(() => player.destroy())
  player.intent(true); await player.load('first', async () => source('first'))
  const old = player.audio
  await player.prepare('next', async () => source('next'))
  await player.load('next', async () => { throw new Error('must use reserve') })
  assert.notEqual(player.audio, old); assert.equal(player.audio.src, 'next'); assert.equal(player.state.status, 'playing')
  const audio = player.audio as unknown as FakeAudio
  audio.onwaiting?.(); t.mock.timers.tick(7999); assert.equal(advances, 0)
  player.intent(false); t.mock.timers.tick(1); assert.equal(advances, 0)
  player.intent(true); audio.onwaiting?.(); t.mock.timers.tick(8000); assert.equal(advances, 1)
  audio.onended?.(); assert.equal(advances, 1)
})
