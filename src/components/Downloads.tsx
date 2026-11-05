import { clearOffline } from '../lib/offline'
import { useState } from 'react'
import Confirm from './Confirm'
import { libraryRequest, type Library, type LibraryTrack } from '../lib/libraryClient'
import { deleteDownload, pendingDownloadDeletes } from '../lib/downloadActions'
import { isDownloadRemoved } from '../lib/listeningPolicy'

export default function Downloads({ data, error, refresh, play }: { data: Library | null; error: string; refresh: () => void; play: (track: LibraryTrack) => void }) {
  const [removing, setRemoving] = useState<LibraryTrack | null>(null)
  const [starting, setStarting] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [message, setMessage] = useState('')
  const [mirror, setMirror] = useState(() => localStorage.getItem('ytm.mirrorPaused') !== '1')
  const summary = data?.summary
  const tracks = data?.tracks.filter(t => !isDownloadRemoved(t.id)) || []
  const done = tracks.filter(t => t.status === 'done')
  const pending = pendingDownloadDeletes().length
  return <section className="mt-3 rounded-xl bg-white/[.06] p-3" aria-label="Baixadas">
    <h2 className="text-xl font-bold">Baixadas</h2>
    <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={mirror} onChange={e => { setMirror(e.target.checked); localStorage.setItem('ytm.mirrorPaused', e.target.checked ? '0' : '1'); if (!e.target.checked) void clearOffline().then(refresh).catch(() => setMessage('Não foi possível limpar a cópia do navegador.')); else refresh() }} />Manter cópia no navegador para ouvir com o motor desligado</label>
    <p className="mt-1 text-xs text-white/50">Essa cópia ocupa espaço extra. Desativar libera esse espaço, mantendo os downloads do motor.</p>
    <p className="mt-1 text-xs text-white/60">Downloads automáticos · máximo de 40 músicas. A renovação diária substitui as antigas quando necessário.</p>
    {pending > 0 && <p role="status" className="mt-2 text-sm text-amber-300">{pending} exclusão(ões) pendente(s); tentaremos novamente automaticamente.</p>}
    <p className="mt-1 text-sm">Offline: {done.length} faixas · {Math.floor(done.reduce((n,t) => n + t.duration, 0) / 60)} min · {(done.reduce((n,t) => n + t.bytes, 0) / 1048576).toFixed(0)} MB</p>
    {summary && <p className="mt-1 text-xs text-white/60">Próxima atualização: {summary.nextRunAt ? new Date(summary.nextRunAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ao preparar o plano'} · {summary.lastRunStatus}</p>}
    {(summary?.minutes || 0) < 120 && <p className="mt-1 text-xs text-amber-300">Cobertura de 120 min ainda incompleta.</p>}
    {summary && summary.pauseUntil > Date.now() && <p className="mt-1 text-sm text-amber-300">Fonte bloqueada. Nova tentativa às {new Date(summary.pauseUntil).toLocaleTimeString('pt-BR')}.</p>}
    {(error || message) && <p role="status" className="my-2 text-sm text-amber-300">{message || error}</p>}
    {summary?.running && <p className="my-3 text-sm">Baixando… Você pode excluir uma faixa durante o download.</p>}
    <button disabled={starting || summary?.running || !tracks.some(t => t.status !== 'done')} onClick={async () => {
      setStarting(true); setMessage('')
      try { await libraryRequest('/run', 'POST'); setMessage('Fila iniciada. Acompanhe o progresso abaixo.'); refresh() }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível iniciar os downloads.') }
      finally { setStarting(false) }
    }} className="my-3 mr-2 rounded-full bg-[#ff0033] px-4 py-2 text-sm disabled:opacity-40">{starting ? 'Iniciando…' : summary?.running ? 'Baixando…' : 'Baixar agora'}</button>
    {tracks.length > 0 && <div role="status" className="my-2 text-sm"><p>{done.length} de {tracks.length} músicas baixadas</p><progress aria-label="Progresso da fila" value={tracks.reduce((n, t) => n + (t.status === 'done' ? 100 : t.status === 'downloading' ? t.percent : 0), 0)} max={tracks.length * 100} className="h-2 w-full accent-[#ff0033]" /></div>}
    <button disabled={!tracks.length} onClick={() => setCleaning(true)} className="my-3 rounded-full border border-white/30 px-4 py-2 text-sm disabled:opacity-40">Excluir todas as baixadas</button>
    {summary?.etaSec != null && <p className="mb-2 text-xs text-white/60">Estimativa: {Math.ceil(summary.etaSec / 60)} min restantes, conforme a taxa atual.</p>}

    <div className="max-h-96 overflow-y-auto">
      {tracks.map(track => <div key={track.id} className="border-t border-white/10 py-3">
        <div className="flex items-center gap-2">
          <button disabled={track.status !== 'done'} onClick={() => play(track)} aria-label={'Tocar ' + track.title} className="shrink-0"><img src={`https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`} alt="" className="h-11 w-11 rounded object-cover" /></button>
          <div className="min-w-0 flex-1"><p className="truncate text-sm">{track.title}</p><p className="truncate text-xs text-white/60">{track.artist}</p>
            <p className="text-xs text-white/70">{track.status === 'done' ? '✓ Baixada' : track.status === 'downloading' ? `↓ ${track.percent}% · ${(track.bytes / 1048576).toFixed(1)} MB` : track.status === 'resolving' ? 'Preparando áudio…' : track.status === 'failed' ? '⚠ Falhou' : 'Na fila'}</p></div>
          <button aria-label={'Excluir ' + track.title} onClick={() => setRemoving(track)} className="text-xs text-white/60 disabled:opacity-30">Excluir</button>
        </div>
        {track.status === 'downloading' && <progress value={track.percent} max={100} aria-label={'Download de ' + track.title} className="mt-2 h-1 w-full accent-[#ff0033]" />}
        {track.status === 'failed' && <div className="mt-2 text-xs"><span className="text-amber-300">{track.error}</span></div>}
      </div>)}
    </div>
    {cleaning && <Confirm requireAcknowledgement={false} title="Excluir todas as baixadas?" message="Os áudios serão apagados do celular e do navegador, liberando espaço. Não serão guardadas cópias ocultas nem essas faixas serão baixadas novamente automaticamente." onCancel={() => setCleaning(false)} onConfirm={async () => {
      let failed = false
      for (const track of tracks) { try { await deleteDownload(track.id) } catch { failed = true } }
      refresh(); setCleaning(false)
      setMessage(failed ? 'Algumas exclusões estão pendentes e serão retomadas automaticamente.' : 'Downloads excluídos.')
    }} />}
    {removing && <Confirm requireAcknowledgement={false} title="Excluir do aparelho?" message={`A faixa “${removing.title}” e suas cópias serão apagadas, liberando espaço. Ela não voltará aos downloads nem às filas automáticas.`} onCancel={() => setRemoving(null)} onConfirm={async () => {
      try { await deleteDownload(removing.id); setRemoving(null); setMessage('Faixa excluída.') }
      finally { refresh() }
    }} />}
  </section>
}
