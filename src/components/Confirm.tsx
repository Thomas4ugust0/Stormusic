import { useEffect, useId, useRef, useState } from 'react'

export default function Confirm({ title, message, onCancel, onConfirm, returnFocus }: {
  title: string; message: string; onCancel: () => void; onConfirm: () => Promise<void>; returnFocus?: HTMLElement | null
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const titleId = useId(); const messageId = useId()
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const previous = returnFocus ?? document.activeElement as HTMLElement | null
    dialog.current?.showModal(); cancel.current?.focus()
    return () => { dialog.current?.close(); queueMicrotask(() => { if (previous?.isConnected) previous.focus() }) }
  }, [])
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={messageId}
    onCancel={e => { e.preventDefault(); if (!busy) onCancel() }}
    className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-white/20 bg-[#030303] p-5 text-white backdrop:bg-black/80">
    <h2 id={titleId} className="text-xl font-bold">{title}</h2>
    <p id={messageId} className="mt-3 text-sm text-white/70">{message}</p>
    <label className="my-5 flex items-center gap-3"><input type="checkbox" checked={understood} disabled={busy} onChange={e => setUnderstood(e.target.checked)} /> Entendi</label>
    {error && <p role="alert" className="mb-3 text-sm text-[#ff4e6b]">{error}</p>}
    <div className="flex gap-3">
      <button ref={cancel} disabled={busy} onClick={onCancel} className="flex-1 rounded-full border border-white/30 p-3 disabled:opacity-40">Cancelar</button>
      <button disabled={!understood || busy} onClick={async () => {
        setBusy(true); setError('')
        try { await onConfirm() } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir.'); setBusy(false) }
      }} className="flex-1 rounded-full bg-[#ff0033] p-3 font-semibold disabled:opacity-40">{busy ? 'Aguarde…' : 'Confirmar'}</button>
    </div>
  </dialog>
}
