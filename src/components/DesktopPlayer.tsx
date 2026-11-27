import { Maximize2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { fmt, thumb, type Track } from '../lib/data'

declare global {
  interface Window {
    stormusicDesktop?: { setCompact: (compact: boolean) => Promise<boolean> }
  }
}

type Props = {
  track?: Track
  time: number
  duration: number
  wantsPlay: boolean
  message: string
  volume: number
  onVolumeChange: (volume: number) => void
  onExpand: () => void
  onStart: () => void
  onPrevious: () => void
  onToggle: () => void
  onNext: () => void
  onSeek: (position: number) => void
}

export default function DesktopPlayer({ track, time, duration, wantsPlay, message, volume, onVolumeChange, onExpand, onStart, onPrevious, onToggle, onNext, onSeek }: Props) {
  const button = 'grid size-9 shrink-0 place-items-center rounded-full hover:bg-white/15'
  return <main aria-label="Widget do Stormusic" className="flex h-full flex-col justify-center gap-2 overflow-auto bg-gradient-to-br from-[#321724] via-[#18131b] to-[#101018] px-4 py-2 text-white">
    <div className="flex items-center gap-3">
      <img src={track ? thumb(track, 'mq') : '/stormusic-icon-192.png'} className="size-12 shrink-0 rounded-lg object-cover" alt="" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold" title={track?.title}>{track?.title || 'Stormusic'}</div>
        <div className="truncate text-xs text-white/65" title={track?.artist}>{track?.artist || 'Nenhuma faixa selecionada'}</div>
      </div>
      <button type="button" className={button} onClick={onExpand} aria-label="Voltar ao app" title="Voltar ao app" autoFocus><Maximize2 size={17} /></button>
    </div>
    {track ? <div className="flex items-center gap-2">
      <button type="button" className={button} onClick={onPrevious} aria-label="Faixa anterior" title="Faixa anterior"><SkipBack size={18} fill="currentColor" /></button>
      <button type="button" className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-[#171219] hover:bg-[#ffd4df]" onClick={onToggle} aria-label={wantsPlay ? 'Pausar' : 'Reproduzir'} title={wantsPlay ? 'Pausar' : 'Reproduzir'}>
        {wantsPlay ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
      </button>
      <button type="button" className={button} onClick={onNext} aria-label="Próxima faixa" title="Próxima faixa"><SkipForward size={18} fill="currentColor" /></button>
      <span className="ml-1 text-[10px] tabular-nums text-white/70">{fmt(time)}</span>
      <input aria-label="Posição da faixa" aria-valuetext={fmt(time)} className="min-w-12 flex-1 accent-[#ff557a] disabled:opacity-40" type="range" min={0} max={duration || 1} step={0.5} value={Math.min(time, duration)} disabled={!duration} onChange={event => onSeek(Number(event.target.value))} />
      <span className="text-[10px] tabular-nums text-white/70">{fmt(duration)}</span>
    </div> : <button type="button" onClick={onStart} className="flex h-9 w-fit items-center gap-2 rounded-full bg-white px-4 text-xs font-semibold text-[#171219]"><Play size={16} fill="currentColor" /> Tocar Supermix</button>}
    <div className="flex min-h-6 items-center gap-3">
      <DesktopVolume value={volume} onChange={onVolumeChange} />
      {message && <p role="status" className="min-w-0 truncate text-xs text-white/75" title={message}>{message}</p>}
    </div>
  </main>
}

export function DesktopVolume({ value, onChange }: { value: number; onChange: (volume: number) => void }) {
  const Icon = value === 0 ? VolumeX : Volume2
  return <label className="flex shrink-0 items-center gap-2 text-xs text-white/80">
    <Icon aria-hidden="true" size={16} />
    <input type="range" min={0} max={100} value={value} aria-label="Volume" aria-valuetext={`${value}%`} className="h-6 w-24 accent-[#ff557a]" onChange={event => onChange(event.currentTarget.valueAsNumber)} />
    <span aria-hidden="true" className="w-9 text-right tabular-nums">{value}%</span>
  </label>
}

export function DesktopUpdates() {
  return <section className="mt-6 space-y-2 rounded-xl bg-white/[.06] p-4 text-sm">
    <h2 className="text-lg font-bold">Atualizações do Windows</h2>
    <p className="text-white/70">Feche o Stormusic antes de abrir uma nova versão do executável. Seu perfil e sua biblioteca ficam no PC.</p>
    <a className="inline-block rounded-lg bg-white/10 px-3 py-2" href="https://github.com/Thomas4ugust0/Stormusic/releases">Ver versões no GitHub</a>
  </section>
}
