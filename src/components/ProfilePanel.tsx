import { useEffect, useRef, useState } from 'react'
import Confirm from './Confirm'
import { downloadSummary, hasBackup, hasDownloadBackup, restoreDownloads, restoreTaste, safeReset } from '../lib/safety'

export default function ProfilePanel({ likes, locked, onClose, onChanged, onUndo }: {
  likes: number; locked: boolean; onClose: () => void; onChanged: () => void
  onUndo: (message: string, action: () => void | Promise<void>) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const [summary, setSummary] = useState<{ count: number; bytes: number } | null>(null)
  const [error, setError] = useState('')
  const [action, setAction] = useState<'taste' | 'downloads' | 'restoreTaste' | 'restoreDownloads' | null>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal(); close.current?.focus()
    return () => { dialog.current?.close(); queueMicrotask(() => { if (previous?.isConnected) previous.focus() }) }
  }, [])
  useEffect(() => {
    let alive = true
    setSummary(null)
    downloadSummary().then(value => { if (alive) setSummary(value) }).catch(() => { if (alive) setError('Não foi possível conferir os downloads. Feche e tente novamente.') })
    return () => { alive = false }
  }, [locked])
  const restore = async (kind: 'taste' | 'downloads') => {
    if (kind === 'taste') restoreTaste(); else await restoreDownloads()
    onChanged()
  }
  const descriptions = {
    taste: `Serão reiniciadas ${likes} curtidas e o histórico de gosto. Preferências do perfil e áudios permanecem. Backup válido por sete dias.`,
    downloads: `Serão removidas ${summary?.count ?? 0} faixas (${((summary?.bytes ?? 0) / 1048576).toFixed(1)} MB) do navegador. Os arquivos no Termux permanecem. A cópia automática ficará pausada até tocar em Baixar agora. Uma cópia recuperável por sete dias será mantida e continuará ocupando espaço. Curtidas permanecem. Se faltar espaço para a cópia, a limpeza será cancelada.`,
    restoreTaste: 'O gosto, as curtidas e as preferências atuais serão substituídos pelo backup dos últimos sete dias.',
    restoreDownloads: 'As faixas salvas no backup voltarão à área offline. A identificação do mix offline será restaurada.',
  }
  return <dialog ref={dialog} aria-labelledby="profile-title" onCancel={e => { e.preventDefault(); if (!action) onClose() }}
    className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-white/20 bg-[#030303] p-5 text-white backdrop:bg-black/80">
    <div className="flex items-center justify-between"><h2 id="profile-title" className="text-xl font-bold">Perfil</h2><button ref={close} onClick={onClose} className="rounded-full border border-white/30 px-4 py-2">Fechar</button></div>
    <p className="my-4 text-sm text-white/70">{likes} curtidas · {summary ? `${summary.count} faixas offline · ${(summary.bytes / 1048576).toFixed(1)} MB` : 'Conferindo downloads…'}</p>
    {error && <p role="alert">{error}</p>}
    {locked && <p className="mb-3 text-sm">Aguarde o download ou a geração do mix terminar para alterar os dados.</p>}
    <div className="flex flex-col gap-3">
      <button disabled={locked || !hasBackup()} onClick={e => { trigger.current = e.currentTarget; setAction('restoreTaste') }} className="rounded-xl border border-white/30 p-3 disabled:opacity-40">Restaurar backup de gosto e curtidas</button>
      <button disabled={locked || !hasDownloadBackup()} onClick={e => { trigger.current = e.currentTarget; setAction('restoreDownloads') }} className="rounded-xl border border-white/30 p-3 disabled:opacity-40">Restaurar backup de downloads</button>
      <h3 className="mt-4 font-semibold text-[#ff4e6b]">Zona de risco</h3>
      <button disabled={locked} onClick={e => { trigger.current = e.currentTarget; setAction('taste') }} className="rounded-xl border border-[#ff0033] p-3 disabled:opacity-40">Reiniciar gosto e curtidas</button>
      <button disabled={locked || !summary} onClick={e => { trigger.current = e.currentTarget; setAction('downloads') }} className="rounded-xl border border-[#ff0033] p-3 disabled:opacity-40">Limpar cópia do navegador</button>
    </div>
    {action && <Confirm returnFocus={trigger.current} title={action.startsWith('restore') ? 'Restaurar backup' : action === 'taste' ? 'Reiniciar gosto e curtidas' : 'Limpar cópia do navegador'} message={descriptions[action]} onCancel={() => setAction(null)} onConfirm={async () => {
      if (locked) throw new Error('Aguarde as operações em andamento terminarem.')
      if (action === 'restoreTaste' || action === 'restoreDownloads') await restore(action === 'restoreTaste' ? 'taste' : 'downloads')
      else {
        await safeReset(action, true)
        onChanged()
        const kind = action
        onUndo(kind === 'taste' ? 'Gosto e curtidas reiniciados' : 'Downloads removidos da área offline', () => restore(kind))
      }
      setAction(null); onClose()
    }} />}
  </dialog>
}
