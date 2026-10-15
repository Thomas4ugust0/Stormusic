import { library, saveLibrary } from './library.ts'
import { readPlan } from './planner.ts'
import { isRunning, runDownloads } from './downloads.ts'

export function schedule(now: number, random = Math.random) {
  const next = new Date(now); next.setHours(24, 0, 0, 0)
  const end = new Date(next); end.setHours(7, 0, 0, 0)
  return { nextRunAt: next.getTime() + Math.floor(random() * 600001), windowEndAt: end.getTime() }
}
export function sameDay(a: number, b: number) { return new Date(a).toDateString() === new Date(b).toDateString() }
export function schedulingDecision({ now, nextRunAt, lastRunAt, lastRunStatus, startup, incomplete, hasPlan, running }: {
  now: number; nextRunAt: number; lastRunAt: number; lastRunStatus: string; startup: boolean; incomplete: boolean; hasPlan: boolean; running: boolean
}) {
  const due = nextRunAt > 0 && now >= nextRunAt
  const catchUp = startup && incomplete && (!sameDay(lastRunAt, now) || lastRunStatus !== 'concluído')
  const end = new Date(now); end.setHours(7, 0, 0, 0)
  return { reschedule: !nextRunAt || due, run: hasPlan && !running && (due || catchUp), until: now < end.getTime() ? end.getTime() : 0 }
}
let started = false
export async function startScheduler(clock = Date.now) {
  if (started) return
  started = true
  let ticking = false
  const tick = async (startup = false) => {
    if (ticking) return
    ticking = true
    try {
      const state = await library(), plan = await readPlan(), now = clock()
      const incomplete = plan.tracks.some(t => !state.tracks.some(e => e.id === t.id && e.status === 'done' && !e.removed))
      const decision = schedulingDecision({ ...state, now, startup, incomplete, hasPlan: !!plan.tracks.length, running: isRunning() })
      if (decision.reschedule) { state.nextRunAt = schedule(now).nextRunAt; await saveLibrary() }
      if (decision.run) void runDownloads(decision.until).catch(() => console.warn('Stormusic: lote interrompido; estado preservado.'))
    } catch { console.warn('Stormusic: não foi possível ler o agendamento; dados preservados.') }
    finally { ticking = false }
  }
  await tick(true)
  setInterval(() => void tick(), 15000).unref()
}
