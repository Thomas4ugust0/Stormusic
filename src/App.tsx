import Downloads from './components/Downloads'
import { Player } from './lib/player'
import { initialPlayer } from './lib/playerMachine'
import { buildPlan, type DailyPlan } from './lib/dailyPlan'
import { libraryRequest, sendPlan, type Library as ServerLibrary } from './lib/libraryClient'
import { mirrorLibrary } from './lib/offline'
import { tasteEvents } from './lib/taste'
import LocalEngine from './components/LocalEngine'
import ProfilePanel from './components/ProfilePanel'
import Confirm from './components/Confirm'
import { backupTaste } from './lib/safety'
import { getMode } from './lib/stream'
import { rememberDuration, knownDuration } from './lib/taste'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Home, Compass, Library, Clapperboard, Play, Pause, SkipForward, SkipBack, ThumbsUp, ThumbsDown, ChevronDown, Search, Sparkles, Check, RefreshCw, ListMusic, Download, CloudOff, CheckCircle2, Trash2, Smartphone } from 'lucide-react'
import { TRACKS, GENRES, ARTISTS, MOODS, thumb, fmt, type Track, type Mood } from './lib/data'
import { buildBlock, type Profile, type Feedback } from './lib/supermix'
import { generateSupermix, savedMix, radioFrom, extend, record, recordPlayback, likedTracks, isLiked, hitToTrack, type Mix as MixT } from './lib/taste'
import { offlineTracks, offlineState, isOffline, storageInfo } from './lib/offline'
import { resolveAudio, prefetch, invalidate, getRelay, setRelay, getAudioFlow, setAudioFlow, testAudioFlow, afFromHost, lastAudioFlowError, searchMusic, type AudioFlowCfg } from './lib/stream'

const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T } catch { return d } }
const RED = '#ff0033'
const ago = (at: number) => { const m = Math.round((Date.now() - at) / 60000); return m < 60 ? `há ${Math.max(1, m)} min` : `há ${Math.round(m / 60)}h` }

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="168.6 311.0 686.4 862.5" className="h-8 w-auto shrink-0" role="img" aria-label="Stormusic">
        <path fill="#E50C16" d="M512 311 L855 509.5 L855 975 L512 1173.5 L168.6 974 L168.6 509.2 Z"/>
        <path fill="#fff" d="M505.3 489 L855 699.2 L855 748.8 L505.3 537.5 Z"/>
        <path fill="#fff" d="M505.3 406.2 L855 615 L855 665.2 L505.3 454.8 Z"/>
        <path fill="#fff" d="M168.6 747 L514.5 955 L514.5 1003.5 L168.6 796.2 Z"/>
        <path fill="#fff" d="M168.6 829.2 L514.5 1037.5 L514.5 1085.2 L168.6 879 Z"/>
        <path fill="#fff" d="M450 648.1 Q450 632.2 463.6 640.3 L619.5 733.6 Q632.6 741.4 619.5 749.1 L463.5 840.2 Q450 848.1 450 832.4 Z"/>
      </svg>
      <span className="font-semibold tracking-tight text-[19px] leading-none">Storm<span style={{ color: '#ff4e6b' }}>usic</span></span>
    </div>
  )
}

function Onboarding({ onDone }: { onDone: (p: Profile) => void }) {
  const [step, setStep] = useState(0)
  const [p, setP] = useState<Profile>({ genres: [], subs: [], artists: [] })
  const tog = (k: keyof Profile, v: string) => setP((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }))
  const subs = GENRES.filter((g) => p.genres.includes(g.id))
  const artists = ARTISTS.filter((a) => p.genres.includes(a.genre))
  const can = step === 0 ? p.genres.length > 0 : step === 1 ? p.subs.length > 0 : p.artists.length > 0
  const titles = ['Quais gêneros você curte?', 'Refine seus subgêneros', 'Escolha seus artistas']
  return (
    <div className="h-full flex flex-col bg-[#030303] pt-safe">
      <div className="px-5 pt-6">
        <Logo />
        <div className="flex gap-1.5 mt-6">{[0, 1, 2].map((i) => <div key={i} className="h-1 flex-1 rounded-full" style={{ background: i <= step ? RED : '#333' }} />)}</div>
        <h1 className="text-[28px] font-bold leading-tight mt-6">{titles[step]}</h1>
        <p className="text-white/60 text-sm mt-2">Seu Supermix será construído estritamente a partir destas escolhas.</p>
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-6">
        {step === 0 && (
          <div className="grid grid-cols-2 gap-3">
            {GENRES.map((g) => { const on = p.genres.includes(g.id); return (
              <button key={g.id} onClick={() => tog('genres', g.id)} className="relative h-24 rounded-xl p-3 text-left font-bold text-lg overflow-hidden transition active:scale-95" style={{ background: `linear-gradient(135deg, ${g.color}, #1a1a1a)`, outline: on ? '2px solid #fff' : 'none' }}>
                {g.label}{on && <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white grid place-items-center"><Check size={14} color="#000" /></span>}
              </button>) })}
          </div>
        )}
        {step === 1 && subs.map((g) => (
          <div key={g.id} className="mb-5">
            <div className="text-xs uppercase tracking-widest text-white/50 mb-2">{g.label}</div>
            <div className="flex flex-wrap gap-2">{g.subs.map((s) => { const on = p.subs.includes(s); return <button key={s} onClick={() => tog('subs', s)} className={`px-4 py-2 rounded-lg text-sm transition ${on ? 'bg-white text-black font-medium' : 'bg-white/10'}`}>{s}</button> })}</div>
          </div>
        ))}
        {step === 2 && (
          <div className="grid grid-cols-3 gap-x-3 gap-y-5">
            {artists.map((a) => { const on = p.artists.includes(a.name); const t = TRACKS.find((x) => x.artist === a.name)!; return (
              <button key={a.name} onClick={() => tog('artists', a.name)} className="flex flex-col items-center gap-2 active:scale-95 transition">
                <div className="relative"><img src={thumb(t, 'mq')} className={`w-24 h-24 rounded-full object-cover ${on ? 'ring-2 ring-white' : 'opacity-80'}`} />{on && <span className="absolute bottom-0 right-0 w-7 h-7 rounded-full grid place-items-center" style={{ background: RED }}><Check size={16} /></span>}</div>
                <span className="text-xs text-center leading-tight">{a.name}</span>
              </button>) })}
          </div>
        )}
      </div>
      <div className="px-5 pb-6 pb-safe flex gap-3">
        {step > 0 && <button onClick={() => setStep(step - 1)} className="h-12 px-6 rounded-full bg-white/10 font-medium">Voltar</button>}
        <button disabled={!can} onClick={() => (step < 2 ? setStep(step + 1) : onDone(p))} className="h-12 flex-1 rounded-full bg-white text-black font-semibold disabled:opacity-30 mb-2">{step < 2 ? 'Continuar' : 'Gerar meu Supermix'}</button>
      </div>
    </div>
  )
}

function Row({ t, active, onPlay, right }: { t: Track; active?: boolean; onPlay: () => void; right?: React.ReactNode }) {
  return (
    <div onClick={onPlay} className="flex items-center gap-3 py-2 active:bg-white/5 rounded">
      <img src={thumb(t, 'mq')} className="w-12 h-12 rounded object-cover" />
      <div className="flex-1 min-w-0"><div className={`truncate text-[15px] ${active ? 'text-[#ff4e6b]' : ''}`}>{t.title}</div><div className="truncate text-[13px] text-white/60">{t.artist} · {t.sub}</div></div>
      {knownDuration(t.ytId, t.dur) > 0 && <span className="text-white/50 text-xs">{fmt(knownDuration(t.ytId, t.dur))}</span>}
      {right}
    </div>
  )
}

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(() => load('ytm.profile', null))
  const [fb, setFb] = useState<Feedback>(() => load('ytm.fb', { liked: [], disliked: [], played: [] }))
  const [mood, setMood] = useState<Mood | 'all'>('all')
  const [tab, setTab] = useState<'home' | 'samples' | 'explore' | 'library'>('home')
  const [queue, setQueue] = useState<Track[]>([])
  const [idx, setIdx] = useState(0)
  const [playerState, setPlayerState] = useState(initialPlayer)
  const player = useRef<Player | null>(null)
  const playing = playerState.status === 'playing'
  const setPlaying = (value: boolean) => player.current?.intent(value)
  const togglePlay = () => setPlaying(!player.current?.state.wantPlay)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [full, setFull] = useState(false)
  const [panel, setPanel] = useState<'queue' | 'lyrics' | null>(null)
  const [live, setLive] = useState(true)
  const [source, setSource] = useState('')
  const [toast, setToast] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [confirmOnboardingReset, setConfirmOnboardingReset] = useState(false)
  const [undo, setUndo] = useState<{ message: string; action: () => void | Promise<void>; expires: number } | null>(null)
  const undoBusy = useRef(false)
  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(current => current === undo ? null : current), Math.max(0, undo.expires - Date.now()))
    return () => clearTimeout(timer)
  }, [undo])
  const offerUndo = (message: string, action: () => void | Promise<void>) => setUndo({ message, action, expires: Date.now() + 8000 })
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Track[]>([])
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState('')
  const [relay, setRelayInput] = useState(getRelay)
  const [relayStatus, setRelayStatus] = useState('')
  const [afCfg, setAfCfg] = useState<AudioFlowCfg>(getAudioFlow)
  const [afStatus, setAfStatus] = useState('')
  const audio = useRef<HTMLAudioElement>(null)
  const cur = queue[idx]
  const [mix, setMix] = useState<MixT | null>(savedMix)
  const [mixBusy, setMixBusy] = useState(false)
  const [mixErr, setMixErr] = useState('')
  const [tasteRev, setTasteRev] = useState(0) // re-render after like/dislike
  const listen = useRef<{ t: Track; sec: number; last: number; ended: boolean; suppressed?: boolean; recorded?: boolean } | null>(null)
  const extending = useRef(false)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [library, setLibrary] = useState<ServerLibrary | null>(null)
  const [libraryError, setLibraryError] = useState('')
  const [libraryRev, setLibraryRev] = useState(0)
  const dl = library?.summary.running ? library.summary : null
  const currentDownload = library?.tracks.find(t => t.id === library.summary.currentId)
  const dayPlan = useRef<DailyPlan | null>(load('ytm.dailyPlan', null))
  const planning = useRef(false)
  const planClock = useRef(0)
  const latest = useRef({ profile, mix, online, idx, queue })
  latest.current = { profile, mix, online, idx, queue }
  const [dlErr, setDlErr] = useState('')
  const [offRev, setOffRev] = useState(0) // re-render after offline cache changes
  const [storage, setStorage] = useState<{ used: number; quota: number; persisted: boolean } | null>(null)
  const [installEvt, setInstallEvt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null)

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    const bip = (e: Event) => { e.preventDefault(); setInstallEvt(e as Event & { prompt: () => Promise<void> }) }
    addEventListener('online', on); addEventListener('offline', off); addEventListener('beforeinstallprompt', bip)
    return () => { removeEventListener('online', on); removeEventListener('offline', off); removeEventListener('beforeinstallprompt', bip) }
  }, [])
  const refreshStorage = () => { void storageInfo().then(setStorage) }
  useEffect(refreshStorage, [offRev])

  const startDownload = useCallback(async (m: MixT | null, manual = false) => {
    if (!m?.tracks.length) return
    setDlErr(''); if (manual) localStorage.setItem('ytm.mirrorPaused', '0')
    try { await sendPlan(m.tracks, manual || !dayPlan.current); if (manual) await libraryRequest('/run', 'POST'); setLibraryRev(r => r + 1) }
    catch (e) { setDlErr(e instanceof Error ? e.message : 'Servidor indisponível.') }
  }, [])

  const refreshMix = useCallback(async (force = false) => {
    const context = latest.current
    if (!context.profile || planning.current || !navigator.onLine) return
    if (!force && Date.now() - planClock.current < 30000) return
    planning.current = true; planClock.current = Date.now(); setMixBusy(true); setMixErr('')
    try {
      const previous = dayPlan.current
      let candidates = context.mix?.tracks || []
      const remaining = buildPlan({ previous, events: tasteEvents(), candidates, now: Date.now() })
      if (force || remaining.tracks.length < 25 || remaining.tracks.reduce((n, t) => n + knownDuration(t.ytId, t.dur), 0) < 7200) {
        candidates = (await generateSupermix(context.profile, 40)).tracks
      }
      const plan = buildPlan({ previous, events: tasteEvents(), candidates: candidates.map(t => ({ ...t, dur: knownDuration(t.ytId, t.dur) })), now: Date.now() })
      if (!plan.tracks.length) throw new Error('Ainda não há recomendações suficientes. Seu plano anterior foi preservado.')
      dayPlan.current = plan; localStorage.setItem('ytm.dailyPlan', JSON.stringify(plan))
      const m: MixT = { ...plan, kinds: {}, online: true }; localStorage.setItem('ytm.supermix', JSON.stringify(m)); setMix(m)
      localStorage.setItem('ytm.planPending', '1')
      await sendPlan(plan.tracks, !previous || force)
      localStorage.setItem('ytm.planPending', '0'); setLibraryRev(r => r + 1)
    } catch (e) { setMixErr(e instanceof Error ? e.message : 'Não foi possível atualizar o plano.') }
    finally { planning.current = false; setMixBusy(false) }
  }, [])
  useEffect(() => {
    if (!profile) return
    const sync = async () => {
      const previous = dayPlan.current
      if (previous) {
        try {
          await sendPlan(previous.tracks, localStorage.getItem('ytm.planPending') === '1'); localStorage.setItem('ytm.planPending', '0')
          const status: ServerLibrary = await (await libraryRequest()).json()
          if (!status.summary.running && status.summary.done < status.summary.total) await libraryRequest('/run', 'POST')
        } catch { /* Retry when reconnected. */ }
      }
      void refreshMix()
    }
    void sync()
    const timer = setInterval(() => void refreshMix(), 1800000)
    const hidden = () => { if (document.hidden) void refreshMix() }
    addEventListener('online', sync); document.addEventListener('visibilitychange', hidden)
    return () => { clearInterval(timer); removeEventListener('online', sync); document.removeEventListener('visibilitychange', hidden) }
  }, [profile, refreshMix])
  useEffect(() => { if (!tasteRev) return; const timer = setTimeout(() => void refreshMix(), 30000); return () => clearTimeout(timer) }, [tasteRev, refreshMix])
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (document.hidden || disposed) return
      let delay = 10000
      try {
        const data: ServerLibrary = await (await libraryRequest()).json()
        if (disposed) return
        setLibrary(data); setLibraryError(''); delay = data.summary.running ? 1000 : 10000
        const planned = dayPlan.current?.tracks || latest.current.mix?.tracks || []
        void mirrorLibrary(data.tracks, planned, () => !document.hidden && !['loading', 'buffering'].includes(player.current?.state.status || '')).catch(() => {})
      } catch { if (!disposed) setLibraryError('Servidor parado. As faixas copiadas para o navegador continuam disponíveis.') }
      if (!disposed) timer = setTimeout(poll, delay)
    }
    const visible = () => { clearTimeout(timer); if (!document.hidden) void poll() }
    void poll(); document.addEventListener('visibilitychange', visible)
    const offlineChanged = () => setOffRev(r => r + 1)
    addEventListener('stormusic-offline', offlineChanged)
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); removeEventListener('stormusic-offline', offlineChanged) }
  }, [libraryRev])

  // Online search (debounced) via AudioFlow → YouTube Music "Songs" tab only.
  useEffect(() => {
    const term = q.trim()
    if (!online || libraryError || term.length < 2) { setHits([]); setSearchErr(''); setSearching(false); return }
    let off = false
    setSearching(true)
    const t = setTimeout(() => {
      searchMusic(term).then((r) => {
        if (off) return
        setHits(r.map(hitToTrack))
        setSearchErr('')
      }).catch((e) => { if (!off) { setHits([]); setSearchErr(e instanceof Error ? e.message : String(e)) } })
        .finally(() => { if (!off) setSearching(false) })
    }, 400)
    return () => { off = true; clearTimeout(t) }
  }, [q, online, libraryError])

  useEffect(() => { localStorage.setItem('ytm.fb', JSON.stringify(fb)) }, [fb])
  useEffect(() => { if (profile) localStorage.setItem('ytm.profile', JSON.stringify(profile)) }, [profile])

  // Online Supermix when available; the local catalogue engine handles moods and offline use.
  const preview = useMemo(() => {
    if (!profile) return []
    const base = mood === 'all' && mix?.tracks.length ? mix.tracks : buildBlock(profile, fb, mood, [], 12)
    if (online && !libraryError) return base
    // Offline: only what was downloaded is playable.
    const ids = new Set([...(offlineState()?.ids || []), ...(libraryError ? [] : library?.tracks.filter(t => t.status === 'done').map(t => t.id) || [])])
    return [...new Map([...offlineTracks(), ...(mix?.tracks || [])].map(t => [t.ytId, t])).values()].filter(t => ids.has(t.ytId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, mood, fb, mix, online, offRev, library, libraryError])
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 1800) }

  const startMix = useCallback((list?: Track[], at = 0) => {
    const candidates = list ?? preview
    const allowed = online && !libraryError ? candidates : candidates.filter(t => isOffline(t.ytId) || (!libraryError && library?.tracks.some(x => x.id === t.ytId && x.status === 'done')))
    const selected = candidates[at]
    if (!allowed.length || (selected && !allowed.some(t => t.ytId === selected.ytId))) { flash('Esta faixa ainda não está baixada.'); return }
    setQueue(allowed); setIdx(Math.max(0, allowed.findIndex(t => t.ytId === selected?.ytId))); player.current?.intent(true, player.current.state.trackId !== selected?.ytId)
  }, [preview, online, libraryError, library])

  // Playing a search result starts a radio built from it (YouTube Music algorithm, no variations).
  const playRadio = (t: Track) => {
    if (!online || libraryError) { flash('Busca e rádio indisponíveis. Use as faixas baixadas.'); return }
    startMix([t], 0); flash('Rádio: ' + t.title)
    radioFrom(t, []).then((r) => setQueue((qq) => (qq[0]?.ytId === t.ytId ? [qq[0], ...r.tracks] : qq))).catch(() => {})
  }

  // Mood change recalculates upcoming part of queue instantly
  const changeMood = (m: Mood | 'all') => {
    setMood(m)
    if (profile && queue.length && online && !libraryError) { const head = queue.slice(0, idx + 1); setQueue([...head, ...buildBlock(profile, fb, m, head.map((t) => t.id))]) }
    flash('Supermix recalculado: ' + MOODS.find((x) => x.id === m)!.label)
  }

  const react = (kind: 'like' | 'dislike') => {
    if (!cur || !profile) return
    const nf: Feedback = kind === 'like'
      ? { ...fb, liked: fb.liked.includes(cur.id) ? fb.liked.filter((x) => x !== cur.id) : [...fb.liked, cur.id], disliked: fb.disliked.filter((x) => x !== cur.id) }
      : { ...fb, disliked: [...new Set([...fb.disliked, cur.id])], liked: fb.liked.filter((x) => x !== cur.id) }
    setFb(nf)
    const undoSignal = record(cur, kind === 'like' && isLiked(cur.ytId) ? 'unlike' : kind)
    setTasteRev((r) => r + 1)
    const head = queue.slice(0, idx + 1)
    if (mood !== 'all') setQueue([...head, ...buildBlock(profile, nf, mood, head.map((t) => t.id))])
    else if (kind === 'dislike') setQueue([...head, ...queue.slice(idx + 1).filter((t) => t.artist !== cur.artist)])
    flash(kind === 'like' ? 'Mais faixas como esta no Supermix' : 'Entendido — removendo faixas parecidas')
    if (kind === 'like') {
      const id = cur.id
      const wasLiked = fb.liked.includes(id), wasDisliked = fb.disliked.includes(id)
      offerUndo(wasLiked ? 'Curtida removida' : 'Curtida adicionada', () => {
        undoSignal()
        setFb(current => ({ ...current,
          liked: [...current.liked.filter(x => x !== id), ...(wasLiked ? [id] : [])],
          disliked: [...current.disliked.filter(x => x !== id), ...(wasDisliked ? [id] : [])],
        }))
        setTasteRev(r => r + 1)
      })
    }
    if (kind === 'dislike') { if (listen.current) listen.current.suppressed = true; setIdx((i) => i + 1) }
  }

  const next = useCallback(() => {
    if (!profile) return
    setIdx((i) => {
      if (i + 1 >= queue.length && online && !libraryError) setQueue((qq) => [...qq, ...buildBlock(profile, fb, mood, qq.slice(-15).map((t) => t.id))]) // safety net
      return i + 1
    })
  }, [profile, fb, mood, queue.length, online, libraryError])
  const prev = () => { if (audio.current && audio.current.currentTime > 3) audio.current.currentTime = 0; else setIdx((i) => Math.max(0, i - 1)) }

  // Infinite queue: extend from what is being enjoyed now (online), else from the local engine.
  useEffect(() => {
    if (!profile || !queue.length || idx + 4 < queue.length || extending.current) return
    if (!online || libraryError) {
      // Offline: loop through downloaded tracks only.
      const pool = preview
      if (pool.length) setQueue((qq) => [...qq, ...pool.sort(() => Math.random() - 0.5)])
      return
    }
    extending.current = true
    const snapshot = queue
    ;(mood === 'all' ? extend(snapshot, profile).then((r) => r.tracks) : Promise.reject())
      .catch(() => buildBlock(profile, fb, mood, snapshot.slice(-15).map((t) => t.id)))
      .then((add) => setQueue((qq) => qq === snapshot ? [...qq, ...add.filter((t) => !qq.some((x) => x.ytId === t.ytId))] : qq))
      .finally(() => { extending.current = false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, queue.length])

  const callbacks = useRef({ next, cur })
  callbacks.current = { next, cur }
  useEffect(() => {
    const engine = new Player({
      state: setPlayerState,
      time: (ct, duration) => {
        setTime(ct); if (Number.isFinite(duration) && duration > 0) setDur(duration)
        const l = listen.current
        if (l) {
          const delta = ct - l.last; if (delta > 0 && delta < 2) l.sec += delta; l.last = ct
          if (l.sec >= 30 && !l.recorded && !l.suppressed) { recordPlayback(l.t, l.sec, false); l.recorded = true; setTasteRev(r => r + 1) }
        }
      },
      ended: () => { const a = player.current?.audio; if (listen.current && a && Number.isFinite(a.duration) && a.duration - a.currentTime <= 0.3) listen.current.ended = true; callbacks.current.next() },
      warning: message => { setSource(message); setToast(message) },
      source: value => {
        setSource(value.source); const track = callbacks.current.cur
        if (track && value.duration) rememberDuration(track.ytId, value.duration, track)
        setDur(value.duration || (track ? knownDuration(track.ytId, track.dur) : 0))
        audio.current = engine.audio
      },
    })
    player.current = engine; audio.current = engine.audio
    return () => { engine.destroy(); player.current = null }
  }, [])
  useEffect(() => {
    const l = listen.current
    if (l && !l.recorded && !l.suppressed) { recordPlayback(l.t, l.sec, l.ended); if (l.sec >= 1 || l.ended) setTasteRev(r => r + 1) }
    listen.current = cur ? { t: cur, sec: 0, last: 0, ended: false } : null
    if (!cur) { player.current?.intent(false); return }
    setSource('Preparando áudio…'); setTime(0)
    setFb(f => ({ ...f, played: [...f.played.slice(-40), cur.id] }))
    void player.current?.load(cur.ytId, () => resolveAudio(cur.ytId, TRACKS.indexOf(cur), live))
    if (online && !libraryError) prefetch(queue.slice(idx + 1, idx + 4).map(t => ({ ytId: t.ytId, idx: TRACKS.indexOf(t) })), live)
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: cur.title, artist: cur.artist, album: cur.sub, artwork: [{ src: thumb(cur), sizes: '480x360', type: 'image/jpeg' }] })
  }, [cur?.ytId, idx])
  const upcoming = queue[idx + 1]
  useEffect(() => {
    if (!upcoming) return
    const local = isOffline(upcoming.ytId) || library?.tracks.some(t => t.id === upcoming.ytId && t.status === 'done')
    if (local || (dur > 0 && (time / dur >= 0.4 || dur - time <= 30))) void player.current?.prepare(upcoming.ytId, () => resolveAudio(upcoming.ytId, TRACKS.indexOf(upcoming), live, undefined, 'prefetch'))
  }, [upcoming?.ytId, time, dur, library])
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.setActionHandler('nexttrack', next)
    navigator.mediaSession.setActionHandler('previoustrack', prev)
    navigator.mediaSession.setActionHandler('play', () => setPlaying(true))
    navigator.mediaSession.setActionHandler('pause', () => setPlaying(false))
    navigator.mediaSession.setActionHandler('seekto', details => { if (audio.current && details.seekTime !== undefined) audio.current.currentTime = details.seekTime })
  })

  if (!profile) return <div className="h-full max-w-[480px] mx-auto"><Onboarding onDone={(p) => setProfile(p)} /></div>

  const liked = likedTracks()
  const pct = dur ? (time / dur) * 100 : 0

  const Mix = ({ size = 'lg' }: { size?: 'lg' }) => (
    <button onClick={() => startMix()} className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden text-left active:scale-[.99] transition" data-size={size}>
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">{preview.slice(0, 4).map((t) => <img key={t.id} src={thumb(t)} className="w-full h-full object-cover" />)}</div>
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-[#ff0033]/30" />
      <div className="absolute left-4 right-4 bottom-4">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-white/80"><Sparkles size={14} color={RED} /> Seu Supermix</div>
        <div className="text-[30px] font-bold leading-none mt-1">Supermix{mood !== 'all' ? ` · ${MOODS.find((m) => m.id === mood)!.label}` : ''}</div>
        <div className="text-sm text-white/70 mt-1.5 truncate">{[...new Set(preview.map((t) => t.artist))].slice(0, 4).join(', ')} e mais</div>
        <div className="flex items-center gap-3 mt-3">
          <span className="h-10 px-5 rounded-full bg-white text-black font-semibold flex items-center gap-1.5 text-sm"><Play size={16} fill="#000" /> Tocar</span>
          <span className="text-xs text-white/60">Fila infinita · sem anúncios</span>
        </div>
      </div>
    </button>
  )

  const filtered = [...new Map([...TRACKS, ...offlineTracks(), ...(mix?.tracks || [])].map(t => [t.ytId, t])).values()].filter((t) => (t.title + t.artist + t.genre).toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="h-full max-w-[480px] mx-auto relative bg-[#030303] overflow-hidden flex flex-col">

      <header className="pt-safe sticky top-0 z-20 bg-[#030303]/95 backdrop-blur">
        <div className="h-14 px-4 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-5 text-white/90"><Search size={22} onClick={() => setTab('explore')} /><button aria-label="Abrir perfil" onClick={() => setProfileOpen(true)} className="w-7 h-7 rounded-full bg-[#7c3aed] text-xs font-bold">EU</button></div>
        </div>
        {tab === 'home' && (
          <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">{MOODS.map((m) => <button key={m.id} onClick={() => changeMood(m.id)} className={`shrink-0 h-8 px-3 rounded-lg text-sm transition ${mood === m.id ? 'bg-white text-black font-medium' : 'bg-white/10'}`}>{m.label}</button>)}</div>
        )}
      </header>

      <main className="flex-1 overflow-y-auto no-scrollbar px-4 pb-40">
        {tab === 'home' && (<>
          <Mix />
          <button onClick={() => setTab('library')} className="mt-3 text-sm underline">Baixadas · {library?.summary.done || 0} faixas · {Math.floor(library?.summary.minutes || 0)} min</button>
          {libraryError && <p className="mt-2 text-xs text-amber-300">{libraryError}</p>}
          <div className="flex items-center gap-2 mt-2 text-[11px] text-white/50">
            {mixBusy ? <><RefreshCw size={12} className="animate-spin" /> Gerando seu Supermix com base no seu gosto…</>
              : mix ? <>Plano atualizado {ago(mix.at)} · {mix.tracks.length} faixas</>
              : <>{mixErr ? `Supermix online indisponível: ${mixErr}` : 'Supermix local'}</>}
            <button disabled={mixBusy} onClick={() => void refreshMix(true)} className="ml-auto h-7 px-3 rounded-full bg-white/10 text-white/80 flex items-center gap-1 disabled:opacity-40"><RefreshCw size={12} /> Atualizar</button>
          </div>
          {mixErr && mix && <div className="text-[11px] text-amber-300/80 mt-1">Última atualização falhou: {mixErr}</div>}
          {!online && <div className="mt-3 rounded-xl bg-white/[.06] px-3 py-2.5 flex items-center gap-2 text-sm"><CloudOff size={16} className="text-amber-300" /> Sem conexão · tocando {preview.length} faixas baixadas</div>}
          <div className="mt-3 rounded-xl bg-white/[.06] px-3 py-2.5">
            {dl ? (<>
              <div className="flex items-center gap-2 text-sm"><Download size={16} className="animate-pulse" /> Baixando {dl.done}/{dl.total} · {currentDownload?.title || 'Preparando'} {currentDownload?.percent || 0}%{dl.failed ? ` · ${dl.failed} falharam` : ''}</div>
              <div className="h-1 mt-2 rounded-full bg-white/15 overflow-hidden"><div className="h-full transition-all" style={{ width: `${(dl.done / Math.max(1, dl.total)) * 100}%`, background: RED }} /></div>
            </>) : offlineState() && offlineState()!.at === mix?.at ? (
              <div className="flex items-center gap-2 text-sm"><CheckCircle2 size={16} className="text-emerald-400" /> Disponível no disco · {library?.summary.done} faixas</div>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <Download size={16} className="text-white/60" />
                <span className="text-white/70">{offlineState() ? 'Mix offline anterior salva' : 'Não baixado'}{dlErr ? ` · ${dlErr}` : ''}</span>
                <button disabled={!online || !mix} onClick={() => startDownload(mix, true)} className="ml-auto h-7 px-3 rounded-full bg-white text-black text-xs font-medium disabled:opacity-40">Baixar agora</button>
              </div>
            )}
          </div>
          <h2 className="text-xl font-bold mt-6 mb-2">Próximas no Supermix</h2>
          {preview.slice(0, 8).map((t, i) => <Row key={t.id} t={t} onPlay={() => startMix(preview, i)} right={<span className="flex items-center gap-1.5">{isOffline(t.ytId) && <CheckCircle2 size={14} className="text-emerald-400" aria-label="Baixada" />}</span>} />)}
          {GENRES.filter((g) => profile.genres.includes(g.id)).map((g) => (
            <section key={g.id} className="mt-7">
              <div className="text-xs text-white/50 uppercase tracking-widest">Mix</div><h2 className="text-xl font-bold mb-3">{g.label}</h2>
              <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4">
                {TRACKS.filter((t) => t.genre === g.id && !fb.disliked.includes(t.id)).map((t, i, arr) => (
                  <button key={t.id} onClick={() => startMix(arr, i)} className="shrink-0 w-36 text-left"><img src={thumb(t)} className="w-36 h-36 rounded-lg object-cover" /><div className="text-sm mt-2 truncate">{t.title}</div><div className="text-xs text-white/60 truncate">{t.artist}</div></button>))}
              </div>
            </section>))}
        </>)}

        {tab === 'samples' && (
          <div className="grid grid-cols-2 gap-2 pt-2">{preview.map((t, i) => (
            <button key={t.id} onClick={() => startMix(preview, i)} className="relative aspect-[9/16] rounded-xl overflow-hidden text-left">
              <img src={thumb(t)} className="absolute inset-0 w-full h-full object-cover scale-[1.35]" /><div className="absolute inset-0 bg-gradient-to-t from-black/90 to-transparent" />
              <div className="absolute bottom-3 left-3 right-3"><div className="font-semibold text-sm truncate">{t.title}</div><div className="text-xs text-white/70 truncate">{t.artist}</div></div>
              <Play size={18} fill="#fff" className="absolute top-3 right-3" />
            </button>))}</div>
        )}

        {tab === 'explore' && (<>
          <div className="flex items-center gap-2 h-11 px-4 rounded-full bg-white/10 mt-2"><Search size={18} className="text-white/60" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={online && !libraryError ? 'Pesquisar músicas, artistas' : 'Pesquisar nas baixadas'} className="bg-transparent outline-none flex-1 text-[15px]" /></div>
          {q ? <div className="mt-3">
            {filtered.length > 0 && <><h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-1">Na sua biblioteca</h2>
              {filtered.map((t, i) => <Row key={t.id} t={t} onPlay={() => startMix(filtered, i)} />)}</>}
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mt-4 mb-1 flex items-center gap-2">Músicas · YouTube Music {searching && <RefreshCw size={12} className="animate-spin" />}</h2>
            {hits.map((t, i) => <Row key={t.id} t={t} active={cur?.ytId === t.ytId} onPlay={() => playRadio(t)} />)}
            {!searching && !hits.length && <div className="text-sm text-white/50 py-3">{searchErr || ((!online || libraryError) ? 'Busca online indisponível' : q.trim().length < 2 ? 'Digite ao menos 2 letras' : 'Nenhuma música encontrada')}</div>}
          </div> : (<>
            <h2 className="text-xl font-bold mt-6 mb-3">Humor e gêneros</h2>
            <div className="grid grid-cols-2 gap-2">{GENRES.map((g) => <button key={g.id} onClick={() => { const l = TRACKS.filter((t) => t.genre === g.id); startMix(l) }} className="h-14 rounded-lg bg-white/[.08] text-left px-3 text-sm font-medium border-l-4" style={{ borderColor: g.color }}>{g.label}</button>)}</div>
            <h2 className="text-xl font-bold mt-6 mb-2">Em alta</h2>
            {TRACKS.slice().sort((a, b) => b.energy - a.energy).slice(0, 10).map((t, i, arr) => <Row key={t.id} t={t} onPlay={() => startMix(arr, i)} right={<span className="text-white/50 text-sm w-5">{i + 1}</span>} />)}
          </>)}
        </>)}

        {tab === 'library' && (<>
          <Downloads data={library} error={libraryError} refresh={() => setLibraryRev(r => r + 1)} play={t => startMix([hitToTrack({ ...t, duration: t.duration })])} />

          <div onClick={() => liked.length && startMix(liked)} className="flex items-center gap-3 mt-4 py-2"><div className="w-14 h-14 rounded bg-gradient-to-br from-[#ff0033] to-[#7c3aed] grid place-items-center"><ThumbsUp size={22} fill="#fff" /></div><div><div className="font-medium">Músicas curtidas</div><div className="text-sm text-white/60">{liked.length} faixas</div></div></div>
          <div onClick={() => startMix()} className="flex items-center gap-3 py-2"><div className="w-14 h-14 rounded bg-white/10 grid place-items-center"><Sparkles size={22} color={RED} /></div><div><div className="font-medium">Supermix</div><div className="text-sm text-white/60">{mix ? `Atualizado ${ago(mix.at)}` : 'Local'}</div></div></div>
          <h2 className="text-lg font-bold mt-5 mb-1">Sua árvore de interesses</h2>
          <div className="flex flex-wrap gap-1.5 text-xs">{[...profile.genres.map((g) => GENRES.find((x) => x.id === g)!.label), ...profile.subs, ...profile.artists].map((x) => <span key={x} className="px-2.5 py-1 rounded-full bg-white/10">{x}</span>)}</div>
          <div className="text-xs text-white/50 mt-3">{fb.liked.length} gostei · {fb.disliked.length} não gostei · {fb.played.length} reproduções</div>
          <button onClick={() => setConfirmOnboardingReset(true)} className="mt-3 text-sm h-9 px-4 rounded-full border border-white/20 flex items-center gap-2"><RefreshCw size={14} /> Refazer onboarding</button>
          <h2 className="text-lg font-bold mt-6 mb-1">Offline e app</h2>
          <div className="rounded-xl bg-white/[.06] p-3 space-y-2 text-sm">
            <div className="flex justify-between text-white/70"><span>Espaço usado</span><span>{storage ? `${(storage.used / 1048576).toFixed(0)} MB${storage.quota ? ` de ${(storage.quota / 1073741824).toFixed(1)} GB` : ''}` : '—'}</span></div>
            <div className="flex justify-between text-white/70"><span>Faixas offline</span><span>{offlineState()?.ids.length ?? 0}</span></div>
            <div className="flex justify-between text-white/70"><span>Armazenamento persistente</span><span>{storage?.persisted ? 'Sim' : 'Não'}</span></div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setProfileOpen(true)} className="h-9 px-4 rounded-full border border-white/20 flex items-center gap-2"><Trash2 size={14} /> Limpar cópia do navegador</button>
              {installEvt && <button onClick={async () => { await installEvt.prompt(); setInstallEvt(null) }} className="h-9 px-4 rounded-full bg-white text-black font-medium flex items-center gap-2"><Smartphone size={14} /> Instalar app</button>}
            </div>
          </div>
          <LocalEngine />
          {getMode() === 'audioflow' && <details><summary className="mt-4 text-sm text-white/60">Configuração AudioFlow (legado)</summary>
          <h2 className="text-lg font-bold mt-6 mb-1">Servidor de stream</h2>
          <p className="text-xs text-white/50 mb-2">Relay com yt-dlp no seu PC ou no celular (Termux). Vazio = relay embutido.</p>
          <div className="flex gap-2"><input value={relay} onChange={(e) => setRelayInput(e.target.value)} placeholder="http://192.168.0.10:8787" className="flex-1 h-10 px-3 rounded-lg bg-white/10 outline-none text-sm" />
            <button onClick={async () => { setRelay(relay); setRelayStatus('Testando…')
              if (relay) {
                // The IP typed here may be the AudioFlow API itself: probe it first.
                const cand = { ...getAudioFlow(), url: afFromHost(relay) }
                try { const v = await testAudioFlow(cand); setAudioFlow(cand); setAfCfg(cand); setRelayStatus(`OK · AudioFlow em ${cand.url} · ${v}`); if (cur) invalidate(cur.ytId); return } catch (e) { setRelayStatus(`AudioFlow: ${e instanceof Error ? e.message : e} — testando relay…`) }
              }
              const r = await resolveAudio('fJ9rUzIMcZQ', 0, true); setRelayStatus(r.real ? `OK · ${r.source} · ${fmt(r.duration ?? 0)}` : `Sem resposta — usando demo${lastAudioFlowError ? ` (${lastAudioFlowError})` : ''}`) }} className="h-10 px-4 rounded-lg bg-white text-black text-sm font-medium">Salvar</button></div>
          {relayStatus && <div className="text-xs mt-2 text-emerald-300/80">{relayStatus}</div>}
          <h2 className="text-lg font-bold mt-6 mb-1">AudioFlow API</h2>
          <p className="text-xs text-white/50 mb-2">Seu backend de extração (pasta audioflow/). Quando ativo, tem prioridade sobre o relay. Lembre de incluir esta origem em CORS_ORIGINS.</p>
          <div className="space-y-2">
            <input value={afCfg.url} onChange={(e) => setAfCfg({ ...afCfg, url: e.target.value })} placeholder="http://192.168.0.10:8000" className="w-full h-10 px-3 rounded-lg bg-white/10 outline-none text-sm" />
            <input value={afCfg.key} onChange={(e) => setAfCfg({ ...afCfg, key: e.target.value })} type="password" autoComplete="off" placeholder="API key (af_…) — vazio se AUTH_ENABLED=false" className="w-full h-10 px-3 rounded-lg bg-white/10 outline-none text-sm" />
            <div className="flex gap-1.5">{(['original', 'm4a', 'mp3'] as const).map((f) => <button key={f} onClick={() => setAfCfg({ ...afCfg, format: f })} className={`h-8 px-3 rounded-full text-xs ${afCfg.format === f ? 'bg-white text-black' : 'bg-white/10'}`}>{f === 'original' ? 'Original (sem recodificar)' : f}</button>)}</div>
            <label className="flex items-center gap-2 text-xs text-white/70"><input type="checkbox" checked={afCfg.sponsors} onChange={(e) => setAfCfg({ ...afCfg, sponsors: e.target.checked })} className="accent-[#ff0033]" /> Remover patrocínios (SponsorBlock)</label>
            <label className="flex items-start gap-2 text-xs text-white/70"><input type="checkbox" checked={afCfg.terms} onChange={(e) => setAfCfg({ ...afCfg, terms: e.target.checked })} className="accent-[#ff0033] mt-0.5" /> Confirmo que tenho o direito de baixar e usar o conteúdo reproduzido.</label>
            <button onClick={async () => {
              setAudioFlow(afCfg)
              if (!afCfg.url) { setAfStatus('Desativada'); return }
              if (!afCfg.terms) { setAfStatus('Aceite o termo para ativar'); return }
              setAfStatus('Testando…')
              try { setAfStatus(`Conectada · ${await testAudioFlow(getAudioFlow())}`); if (cur) invalidate(cur.ytId) } catch (e) { setAfStatus(`Sem conexão: ${e instanceof Error ? e.message : e}`) }
            }} className="h-10 px-4 rounded-lg bg-white text-black text-sm font-medium">Salvar e testar</button>
          </div>
          {afStatus && <div className={`text-xs mt-2 ${afStatus.startsWith('Conectada') ? 'text-emerald-300/80' : 'text-amber-300/80'}`}>{afStatus}</div>}
          </details>}
          {liked.length > 0 && <h2 className="text-lg font-bold mt-6 mb-1">Curtidas</h2>}
          {liked.map((t, i) => <Row key={t.id} t={t} onPlay={() => startMix(liked, i)} />)}
        </>)}
      </main>

      {toast && !undo && <div role="status" className="absolute left-1/2 -translate-x-1/2 bottom-[calc(140px+env(safe-area-inset-bottom))] z-40 bg-white text-black text-sm px-4 py-2 rounded-lg shadow-xl whitespace-nowrap">{toast}</div>}
      {undo && <div role="status" className="absolute left-4 right-4 bottom-[calc(140px+env(safe-area-inset-bottom))] z-[60] flex items-center justify-between gap-3 rounded-xl bg-white p-4 text-sm text-black shadow-xl">
        <span>{undo.message}</span><button className="rounded-lg p-2 font-bold underline" onClick={async () => {
          if (undoBusy.current || Date.now() >= undo.expires) return
          undoBusy.current = true
          try { await undo.action(); setUndo(current => current === undo ? null : current); flash('Ação desfeita') }
          catch (e) { flash(e instanceof Error ? e.message : 'Não foi possível desfazer.'); setUndo(current => current === undo ? null : current) }
          finally { undoBusy.current = false }
        }}>Desfazer</button>
      </div>}
      {confirmOnboardingReset && <Confirm title="Refazer onboarding" message="O perfil atual será salvo em backup por sete dias. O app abrirá as escolhas de perfil; curtidas, histórico e downloads serão mantidos." onCancel={() => setConfirmOnboardingReset(false)} onConfirm={async () => {
        backupTaste()
        setConfirmOnboardingReset(false)
        setProfile(null)
      }} />}
      {profileOpen && <ProfilePanel likes={new Set([...fb.liked, ...liked.map(t => t.id)]).size} locked={!!dl || mixBusy} onClose={() => setProfileOpen(false)} onUndo={offerUndo} onChanged={() => {
        setFb(load('ytm.fb', { liked: [], disliked: [], played: [] }))
        const restored = load<Profile | null>('ytm.profile', null)
        if (JSON.stringify(restored) !== JSON.stringify(profile)) setProfile(restored)
        setTasteRev(r => r + 1); setOffRev(r => r + 1)
      }} />}

      <div className="absolute bottom-0 inset-x-0 z-30">
        {cur && (
          <div onClick={() => setFull(true)} className="mx-2 mb-1 rounded-lg bg-[#212121] overflow-hidden">
            <div className="flex items-center gap-3 p-2">
              <img src={thumb(cur, 'mq')} className="w-10 h-10 rounded object-cover" />
              <div className="flex-1 min-w-0"><div className="text-sm truncate">{cur.title}</div><div className="text-xs text-white/60 truncate">{cur.artist}</div></div>
              <button onClick={(e) => { e.stopPropagation(); react('dislike') }} className="p-2"><ThumbsDown size={20} /></button>
              <button onClick={(e) => { e.stopPropagation(); react('like') }} className="p-2"><ThumbsUp size={20} fill={isLiked(cur.ytId) ? '#fff' : 'none'} /></button>
              <button onClick={(e) => { e.stopPropagation(); togglePlay() }} className="p-2">{playing ? <Pause size={24} fill="#fff" /> : <Play size={24} fill="#fff" />}</button>
              <button onClick={(e) => { e.stopPropagation(); next() }} className="p-2 pr-1"><SkipForward size={22} fill="#fff" /></button>
            </div>
            <div className="h-0.5 bg-white/20"><div className="h-full bg-white" style={{ width: pct + '%' }} /></div>
          </div>
        )}
        <nav className="bg-[#030303] border-t border-white/10 pb-safe">
          <div className="h-14 grid grid-cols-4">
            {([['home', 'Início', Home], ['samples', 'Amostras', Clapperboard], ['explore', 'Explorar', Compass], ['library', 'Biblioteca', Library]] as const).map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)} className={`flex flex-col items-center justify-center gap-0.5 text-[10px] ${tab === id ? 'text-white' : 'text-white/60'}`}><Icon size={22} strokeWidth={tab === id ? 2.5 : 1.8} />{label}</button>))}
          </div>
        </nav>
      </div>

      {full && cur && (
        <div className="absolute inset-0 z-50 slide-up flex flex-col pt-safe pb-safe" style={{ background: 'linear-gradient(180deg,#3a1a22 0%,#121212 55%,#030303 100%)' }}>
          <div className="h-14 px-4 flex items-center justify-between"><button onClick={() => { setFull(false); setPanel(null) }}><ChevronDown size={28} /></button>
            <div className="flex bg-black/40 rounded-full p-1 text-xs"><span className="px-3 py-1 rounded-full bg-white/15">Música</span></div></div>
          {panel ? (
            <div className="flex-1 overflow-y-auto no-scrollbar px-5">
              {panel === 'lyrics' ? <p className="py-6 text-white/60">Letra indisponível para esta faixa.</p> :
                <>{queue.slice(idx).map((t, i) => <Row key={t.id + i} t={t} active={i === 0} onPlay={() => setIdx(idx + i)}  />)}<div className="text-center text-xs text-white/40 py-4">Fila infinita — novos blocos são gerados automaticamente</div></>}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center px-6"><img src={thumb(cur)} className="w-full aspect-square object-cover rounded-lg shadow-2xl" /></div>
          )}
          <div className="px-6 pt-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0"><div className="text-2xl font-bold truncate">{cur.title}</div><div className="text-white/60 truncate">{cur.artist}</div></div>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => react('dislike')} className="h-9 px-4 rounded-full bg-white/10 flex items-center gap-2 text-sm"><ThumbsDown size={16} /> Não gostei</button>
              <button onClick={() => react('like')} className={`h-9 px-4 rounded-full flex items-center gap-2 text-sm ${isLiked(cur.ytId) ? 'bg-white text-black' : 'bg-white/10'}`}><ThumbsUp size={16} fill={isLiked(cur.ytId) ? '#000' : 'none'} /> Gostei</button>

            </div>
            <input type="range" className="yt w-full mt-5" min={0} max={dur || 1} step={0.5} value={time} style={{ ['--p' as string]: pct + '%' }} onChange={(e) => { if (audio.current) audio.current.currentTime = +e.target.value }} />
            <div className="flex justify-between text-xs text-white/50 mt-1"><span>{fmt(time)}</span><span className="truncate mx-2 text-emerald-300/70">{source}</span><span>{fmt(dur || cur.dur)}</span></div>
            <div className="flex items-center justify-between mt-3">
              <button onClick={prev}><SkipBack size={32} fill="#fff" /></button>
              <button onClick={() => togglePlay()} className="w-[72px] h-[72px] rounded-full bg-white grid place-items-center">{playing ? <Pause size={32} fill="#000" color="#000" /> : <Play size={32} fill="#000" color="#000" className="ml-1" />}</button>
              <button onClick={next}><SkipForward size={32} fill="#fff" /></button>
            </div>
            <div className="flex justify-around mt-5 mb-3 text-sm font-medium">
              {(['queue', 'lyrics'] as const).map((p) => <button key={p} onClick={() => setPanel(panel === p ? null : p)} className={`flex items-center gap-1.5 ${panel === p ? 'text-white' : 'text-white/50'}`}>{p === 'queue' ? <><ListMusic size={16} /> A seguir</> : 'Letra'}</button>)}

            </div>
          </div>
        </div>
      )}
    </div>
  )
}
