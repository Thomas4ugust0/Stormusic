export type PlayerState = { status: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error'; wantPlay: boolean; requestId: number; trackId: string | null }
export type PlayerEvent = { type: 'USER_PLAY' | 'USER_PAUSE' | 'TRACK_CHANGE' | 'RESOLVED' | 'RESOLVE_FAILED' | 'AUDIO_PLAYING' | 'AUDIO_PAUSED' | 'AUDIO_WAITING' | 'AUDIO_ENDED' | 'AUDIO_ERROR'; requestId?: number; trackId?: string; internal?: boolean }
export const initialPlayer: PlayerState = { status: 'idle', wantPlay: false, requestId: 0, trackId: null }
export function reduce(state: PlayerState, event: PlayerEvent): PlayerState {
  if (event.requestId !== undefined && event.type !== 'TRACK_CHANGE' && event.requestId !== state.requestId) return state
  switch (event.type) {
    case 'USER_PLAY': return { ...state, wantPlay: true, status: state.status === 'idle' ? 'idle' : state.status === 'loading' ? 'loading' : 'buffering' }
    case 'USER_PAUSE': return { ...state, wantPlay: false, status: 'paused' }
    case 'TRACK_CHANGE': return { ...state, status: 'loading', trackId: event.trackId || null, requestId: state.requestId + 1 }
    case 'RESOLVED': return { ...state, status: state.wantPlay ? 'buffering' : 'paused' }
    case 'RESOLVE_FAILED': case 'AUDIO_ERROR': return { ...state, status: 'error', wantPlay: false }
    case 'AUDIO_PLAYING': return { ...state, status: state.wantPlay ? 'playing' : 'paused' }
    case 'AUDIO_PAUSED': return event.internal ? state : { ...state, status: 'paused', wantPlay: false }
    case 'AUDIO_WAITING': return state.wantPlay ? { ...state, status: 'buffering' } : state
    case 'AUDIO_ENDED': return { ...state, status: 'idle' }
  }
}
