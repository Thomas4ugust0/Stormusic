import { initialPlayer, reduce, type PlayerEvent, type PlayerState } from './playerMachine.ts'

type Source = { url: string; duration?: number; source: string }
type Hooks = { state: (state: PlayerState) => void; time: (time: number, duration: number) => void; ended: () => void; warning: (message: string) => void; source: (value: Source) => void }
/** Owns both audio elements. React never resolves or starts a stale element. */
export class Player {
  state = initialPlayer
  elements: HTMLAudioElement[]
  active = 0
  prepared: { id: string; source: Source } | null = null
  preparing = ''
  generation = 0
  advancing = false
  internalPauses = new WeakMap<HTMLAudioElement, number>()
  waiting: ReturnType<typeof setTimeout> | undefined
  tapAt = 0
  endedAt = 0
  hooks: Hooks
  constructor(hooks: Hooks) {
    this.hooks = hooks
    this.elements = [new Audio(), new Audio()]
    for (const element of this.elements) {
      element.preload = 'auto'
      element.onplaying = () => {
        if (element !== this.audio) return
        if (!this.state.wantPlay) { this.pause(element); return }
        this.clearWaiting(); this.dispatch({ type: 'AUDIO_PLAYING' })
        this.measure('tap_to_playing_ms', this.tapAt); this.tapAt = 0
        this.measure('gap_ms', this.endedAt); this.endedAt = 0
      }
      element.onpause = () => { const pending = this.internalPauses.get(element) || 0; if (pending) { this.internalPauses.set(element, pending - 1); return } if (element === this.audio && !element.ended && element.dataset.ready === '1' && element.paused) this.dispatch({ type: 'AUDIO_PAUSED' }) }
      element.onwaiting = () => {
        if (element !== this.audio || !this.state.wantPlay) return
        this.dispatch({ type: 'AUDIO_WAITING' }); this.clearWaiting()
        this.waiting = setTimeout(() => { if (!this.state.wantPlay) return; this.hooks.warning('Faixa sem resposta; avançando.'); this.advance() }, 8000)
      }
      element.ontimeupdate = () => {
        if (element !== this.audio) return
        this.hooks.time(element.currentTime, element.duration)
        if ('mediaSession' in navigator && Number.isFinite(element.duration) && element.duration > 0) {
          try { navigator.mediaSession.setPositionState({ duration: element.duration, playbackRate: 1, position: Math.min(element.duration, element.currentTime) }) } catch { /* platform support */ }
        }
        if (this.state.wantPlay && this.prepared && this.elements[1 - this.active].readyState >= 3 && element.duration - element.currentTime <= 0.25) {
          this.endedAt = performance.now(); this.advance()
        }
      }
      element.onended = () => { if (element !== this.audio) return; this.endedAt = performance.now(); this.dispatch({ type: 'AUDIO_ENDED' }); this.advance() }
      element.onerror = () => { if (element === this.audio && element.dataset.ready === '1') { this.clearWaiting(); this.dispatch({ type: 'AUDIO_ERROR' }); this.hooks.warning('Falha na reprodução. Tente novamente.') } }
    }
  }
  pause(element: HTMLAudioElement) { if (!element.paused) this.internalPauses.set(element, (this.internalPauses.get(element) || 0) + 1); element.pause() }
  advance() { if (this.advancing) return; this.advancing = true; this.hooks.ended() }
  get audio() { return this.elements[this.active] }
  dispatch(event: PlayerEvent) { this.state = reduce(this.state, event); this.hooks.state(this.state); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = this.state.status === 'playing' ? 'playing' : 'paused' }
  intent(play: boolean, defer = false) {
    if (play) this.tapAt = performance.now()
    this.dispatch({ type: play ? 'USER_PLAY' : 'USER_PAUSE' })
    if (!play) { this.clearWaiting(); this.pause(this.audio) }
    else if (!defer && this.audio.dataset.ready === '1') void this.play()
  }
  async play() {
    const element = this.audio, requestId = this.state.requestId
    try { await element.play(); if (!this.state.wantPlay || element !== this.audio) this.pause(element) }
    catch { if (element !== this.audio || requestId !== this.state.requestId) return; this.dispatch({ type: 'USER_PAUSE' }); this.hooks.warning('Toque em reproduzir para iniciar o áudio.') }
  }
  async load(id: string, resolve: () => Promise<Source>) {
    this.advancing = false; this.clearWaiting(); this.dispatch({ type: 'TRACK_CHANGE', trackId: id })
    const requestId = this.state.requestId
    const old = this.audio
    old.dataset.ready = '0'
    if (this.prepared?.id === id) {
      const source = this.prepared.source; this.prepared = null; this.preparing = ''; this.generation++
      this.active = 1 - this.active; this.pause(old); old.removeAttribute('src'); old.load()
      this.audio.dataset.ready = '1'; this.hooks.source(source); this.dispatch({ type: 'RESOLVED', requestId })
      if (this.state.wantPlay) await this.play()
      return
    }
    this.generation++; this.prepared = null; this.preparing = ''
    this.pause(old); old.removeAttribute('src'); old.load()
    try {
      const source = await resolve()
      if (requestId !== this.state.requestId) return
      this.audio.src = source.url; this.audio.dataset.ready = '1'; this.hooks.source(source)
      this.dispatch({ type: 'RESOLVED', requestId })
      if (this.state.wantPlay) await this.play()
    } catch (error) {
      if (requestId !== this.state.requestId) return
      this.dispatch({ type: 'RESOLVE_FAILED', requestId }); this.hooks.warning(error instanceof Error ? error.message : 'Não foi possível tocar a faixa.')
    }
  }
  async prepare(id: string, resolve: () => Promise<Source>) {
    if (this.prepared?.id === id || this.preparing === id) return
    this.preparing = id; this.prepared = null
    const generation = ++this.generation, element = this.elements[1 - this.active]
    element.dataset.ready = '0'; this.pause(element); element.removeAttribute('src'); element.load()
    try { const source = await resolve(); if (generation !== this.generation || element === this.audio) return; element.src = source.url; element.load(); this.prepared = { id, source } }
    catch { /* The ordinary load path reports errors if this track becomes current. */ }
    finally { if (generation === this.generation) this.preparing = '' }
  }
  clearWaiting() { clearTimeout(this.waiting); this.waiting = undefined }
  measure(kind: string, start: number) {
    if (!start) return
    try { const values = JSON.parse(localStorage.getItem('ytm.playerMetrics') || '[]'); values.push({ kind, id: this.state.trackId, at: Date.now(), ms: Math.round(performance.now() - start) }); localStorage.setItem('ytm.playerMetrics', JSON.stringify(values.slice(-200))) } catch { /* Metrics never interrupt playback. */ }
  }
  destroy() { this.generation++; this.state = { ...this.state, requestId: this.state.requestId + 1 }; this.clearWaiting(); for (const element of this.elements) { element.dataset.ready = '0'; this.pause(element); element.removeAttribute('src'); element.load() } }
}
