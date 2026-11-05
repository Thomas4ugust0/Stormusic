import { useEffect, useState } from 'react'
import { getMode, localRequest, resolveAudio, setMode } from '../lib/stream'

type Health = { status: string; js_runtime: string; ytdlp_version: string | null; state: 'idle' | 'running' | 'ok' | 'failed'; updated_at: number | null; message: string }
export default function LocalEngine() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [mode, updateMode] = useState(getMode)
  const check = async () => {
    try { const h = await (await localRequest('/health', {}, 15000)).json(); setHealth(h); setError(''); return h as Health }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); return null }
  }
  useEffect(() => { void check() }, [])
  useEffect(() => {
    if (health?.state !== 'running' || busy) return
    const timer = setInterval(() => void check(), 2000)
    return () => clearInterval(timer)
  }, [health?.state, busy])
  const update = async (target: 'app' | 'ytdlp') => {
    if (target === 'app' && !confirm('Atualizar o Stormusic? A reprodução será interrompida e o app será recarregado.')) return
    setBusy(true); setError('')
    const old = health?.ytdlp_version
    try {
      await localRequest('/api/admin/update-' + target, { method: 'POST', headers: { 'X-Stormusic': '1' } }, 15000)
      setMessage('Atualização em andamento…')
      const deadline = Date.now() + 660000
      let restartDeadline = 0
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000))
        const h = await check()
        if (!h) {
          if (target === 'app') { restartDeadline ||= Date.now() + 30000; if (Date.now() > restartDeadline) throw new Error('Servidor não voltou. Toque no atalho Stormusic e tente novamente.') }
          continue
        }
        if (h.state === 'failed') throw new Error(h.message)
        if (h.state === 'running') continue
        if (target === 'app') {
          // Give the supervisor time to replace the server before checking again.
          await new Promise((r) => setTimeout(r, 2000))
          const ready = await check(); if (!ready) continue
          const registration = await navigator.serviceWorker?.getRegistration()
          await registration?.update()
          const worker = registration?.installing || registration?.waiting
          if (worker && worker.state !== 'activated') await new Promise<void>((resolve, reject) => {
            const finish = () => {
              if (worker.state === 'activated') { clearTimeout(timer); worker.removeEventListener('statechange', finish); resolve() }
              else if (worker.state === 'redundant') { clearTimeout(timer); worker.removeEventListener('statechange', finish); reject(new Error('Falha ao instalar a nova interface. Feche e abra o app.')) }
            }
            const timer = setTimeout(() => { worker.removeEventListener('statechange', finish); reject(new Error('A nova interface ainda está sendo instalada. Feche e abra o app.')) }, 15000)
            worker.addEventListener('statechange', finish); finish()
          })
          location.reload(); return
        }
        setMessage(`yt-dlp ${old || '—'} → ${h.ytdlp_version || '—'}. ${h.message}`); return
      }
      throw new Error('A atualização está demorando. Consulte o status novamente.')
    } catch (e) { setMessage(''); setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const button = 'px-3 py-2 rounded-lg bg-white/10 disabled:opacity-40'
  return <section className="mt-6 space-y-2 text-sm">
    <h2 className="text-lg font-bold">Motor local</h2>
    <div className="rounded-xl bg-white/[.06] p-3 space-y-3">
      <p>{health ? `${health.status === 'ok' ? 'Disponível' : 'Precisa de instalação'} · yt-dlp ${health.ytdlp_version || 'ausente'}` : 'Verificando servidor…'}</p>
      {health && <p className="text-xs text-white/60">{health.js_runtime} · Última atualização: {health.updated_at ? new Date(health.updated_at).toLocaleString('pt-BR') : 'ainda não registrada'}</p>}
      {health?.updated_at && Date.now() - health.updated_at > 14 * 86400000 ? <p className="text-amber-300">yt-dlp sem atualização há mais de 14 dias.</p> : null}
      {(message || health?.message) && <p role="status">{message || health?.message}</p>}
      {error && <p role="alert" className="text-amber-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={button} onClick={() => void check()}>Tentar de novo</button>
        <button className={button} disabled={busy} onClick={async () => { setBusy(true); try { const r = await resolveAudio('9bZkp7q19f0', 0, true); setMessage(`Faixa resolvida · ${r.source} · ${Math.round(r.duration || 0)} s`); setError('') } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }}>Testar com uma faixa</button>
        <button className={button} disabled={busy || health?.state === 'running'} onClick={() => void update('ytdlp')}>Atualizar yt-dlp</button>
        <button className={button} disabled={busy || health?.state === 'running'} onClick={() => void update('app')}>Atualizar app</button>
      </div>
      <details><summary className="cursor-pointer text-white/70">Avançado</summary>
        <label className="flex gap-2 mt-3">Modo <select className="bg-[#222] rounded px-2" value={mode} onChange={(e) => { const v = e.target.value as 'local' | 'audioflow'; setMode(v); updateMode(v); location.reload() }}><option value="local">Local (este celular)</option><option value="audioflow">AudioFlow (legado)</option></select></label>
      </details>
    </div>
  </section>
}
