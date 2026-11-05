/** A deletion waits for the writer to close before unlinking its files. */
const jobs = new Map<string, { controller: AbortController; done: Promise<void> }>()
export function startDownloadJob(id: string) {
  const controller = new AbortController()
  let finish!: () => void
  const done = new Promise<void>(resolve => { finish = resolve })
  const job = { controller, done }; jobs.set(id, job)
  return { signal: controller.signal, finish: () => { if (jobs.get(id) === job) jobs.delete(id); finish() } }
}
export async function cancelDownloadJob(id: string) {
  const job = jobs.get(id)
  if (job) { job.controller.abort(); await job.done }
}
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(signal.reason) }
    work.then(value => { signal.removeEventListener('abort', stop); resolve(value) }, error => { signal.removeEventListener('abort', stop); reject(error) })
    if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true })
  })
}
