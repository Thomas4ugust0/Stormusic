import { useState } from 'react'
import Confirm from './Confirm'
import { libraryRequest, type Library, type LibraryTrack } from '../lib/libraryClient'
import { removeCachedTrack } from '../lib/offline'

export default function Downloads({ data, error, refresh, play }: { data: Library | null; error: string; refresh: () => void; play: (track: LibraryTrack) => void }) {
  const [removing, setRemoving] = useState<LibraryTrack | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [message, setMessage] = useState('')
  const action = async (path: string, body?: unknown) => {
    try { if (path === '/run') localStorage.setItem('ytm.mirrorPaused', '0'); await libraryRequest(path, 'POST', body); setMessage(''); refresh() }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Não foi possível concluir.') }
  }
  const summary = data?.summary
  return <section className="mt-3 rounded-xl bg-white/[.06] p-3" aria-label="Baixadas">
    <h2 className="text-xl font-bold">Baixadas</h2>
    <p className="mt-1 text-sm">Offline: {summary?.done || 0} faixas · {Math.floor(summary?.minutes || 0)} min · {((summary?.bytes || 0) / 1048576).toFixed(0)} MB</p>
    {summary && <p className="mt-1 text-xs text-white/60">Próxima atualização: {summary.nextRunAt ? new Date(summary.nextRunAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ao preparar o plano'} · {summary.lastRunStatus}</p>}
    {(summary?.minutes || 0) < 120 && <p className="mt-1 text-xs text-amber-300">Cobertura de 120 min ainda incompleta.</p>}
    {summary && summary.pauseUntil > Date.now() && <p className="mt-1 text-sm text-amber-300">Fonte bloqueada. Nova tentativa às {new Date(summary.pauseUntil).toLocaleTimeString('pt-BR')}.</p>}
    {(error || message) && <p role="status" className="my-2 text-sm text-amber-300">{message || error}</p>}
    <button disabled={!data || summary?.running} onClick={() => void action('/run')} className="my-3 rounded-full bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40">{summary?.running ? 'Baixando no Termux…' : 'Baixar agora'}</button>
    {summary?.etaSec != null && <p className="mb-2 text-xs text-white/60">Estimativa: {Math.ceil(summary.etaSec / 60)} min restantes, conforme a taxa atual.</p>}
    {data?.tracks.some(t => t.cleanupEligible) && <button disabled={summary?.running} onClick={() => setCleaning(true)} className="mb-3 text-xs underline disabled:opacity-40">Limpar faixas fora do plano há mais de 24 h</button>}
    <div className="max-h-96 overflow-y-auto">
      {data?.tracks.map(track => <div key={track.id} className="border-t border-white/10 py-3">
        <div className="flex items-center gap-2">
          <button disabled={track.status !== 'done'} onClick={() => play(track)} aria-label={'Tocar ' + track.title} className="shrink-0"><img src={`https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`} alt="" className="h-11 w-11 rounded object-cover" /></button>
          <div className="min-w-0 flex-1"><p className="truncate text-sm">{track.title}</p><p className="truncate text-xs text-white/60">{track.artist}</p>
            <p className="text-xs text-white/70">{track.status === 'done' ? '✓ Baixada' : track.status === 'downloading' ? `↓ ${track.percent}% · ${(track.bytes / 1048576).toFixed(1)} MB` : track.status === 'resolving' ? 'Preparando áudio…' : track.status === 'failed' ? '⚠ Falhou' : 'Na fila'}</p></div>
          <button disabled={summary?.running} onClick={() => setRemoving(track)} className="text-xs text-white/60 disabled:opacity-30">Remover</button>
        </div>
        {track.status === 'downloading' && <progress value={track.percent} max={100} aria-label={'Download de ' + track.title} className="mt-2 h-1 w-full accent-[#ff0033]" />}
        {track.status === 'failed' && <div className="mt-2 text-xs"><span className="text-amber-300">{track.error}</span><button onClick={() => void action('/retry', { id: track.id })} className="ml-2 underline">Tentar de novo</button></div>}
      </div>)}
    </div>
    {cleaning && <Confirm title="Limpar faixas antigas?" message="O lote novo terminou. Serão retiradas apenas faixas fora do plano há mais de 24 horas, preservando backup de cada áudio." onCancel={() => setCleaning(false)} onConfirm={async () => {
      for (const track of data?.tracks.filter(t => t.cleanupEligible) || []) { await removeCachedTrack(track.id); await libraryRequest('/' + track.id, 'DELETE') }
      setCleaning(false); refresh()
    }} />}
    {removing && <Confirm title="Remover do aparelho?" message={`A faixa “${removing.title}” será retirada das baixadas. O áudio será preservado em backup antes da remoção.`} onCancel={() => setRemoving(null)} onConfirm={async () => {
      // Browser backup first; a server failure leaves its original intact and a recoverable browser copy.
      await removeCachedTrack(removing.id)
      await libraryRequest('/' + removing.id, 'DELETE')
      setRemoving(null); refresh()
    }} />}
  </section>
}
