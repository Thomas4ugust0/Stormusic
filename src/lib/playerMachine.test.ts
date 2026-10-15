import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialPlayer, reduce } from './playerMachine.ts'

test('pause while resolving prevents autoplay; late responses cannot replace current request', () => {
  let state = reduce(initialPlayer, { type: 'USER_PLAY' })
  state = reduce(state, { type: 'TRACK_CHANGE', trackId: 'first' })
  state = reduce(state, { type: 'USER_PAUSE' })
  state = reduce(state, { type: 'RESOLVED', requestId: 1 })
  assert.equal(state.wantPlay, false); assert.equal(state.status, 'paused')
  state = reduce(state, { type: 'TRACK_CHANGE', trackId: 'second' })
  state = reduce(state, { type: 'TRACK_CHANGE', trackId: 'third' })
  assert.equal(reduce(state, { type: 'RESOLVED', requestId: 2 }), state)
  assert.equal(reduce(state, { type: 'RESOLVE_FAILED', requestId: 1 }), state)
  assert.equal(state.trackId, 'third')
})
test('external pause clears intent; internal pause preserves it; actual playing drives status', () => {
  let state = reduce(initialPlayer, { type: 'USER_PLAY' })
  state = reduce(state, { type: 'TRACK_CHANGE', trackId: 'track' })
  state = reduce(state, { type: 'RESOLVED', requestId: 1 })
  assert.equal(state.status, 'buffering')
  state = reduce(state, { type: 'AUDIO_PLAYING' })
  assert.equal(state.status, 'playing')
  assert.equal(reduce(state, { type: 'AUDIO_PAUSED', internal: true }), state)
  state = reduce(state, { type: 'AUDIO_PAUSED' })
  assert.equal(state.wantPlay, false); assert.equal(state.status, 'paused')
  assert.equal(reduce(state, { type: 'AUDIO_WAITING' }), state)
})
