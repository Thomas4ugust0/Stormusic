import { test } from 'node:test'
import assert from 'node:assert/strict'
import { schedule, schedulingDecision } from './scheduler.ts'
test('local midnight jitter, deadline, catch-up and active-run exclusion', () => {
  const now = new Date(2026, 9, 14, 23, 59).getTime()
  const next = schedule(now, () => 0.3)
  const at = new Date(next.nextRunAt)
  assert.equal(at.getDate(), 15); assert.equal(at.getHours(), 0); assert.equal(at.getMinutes(), 3)
  assert.equal(new Date(next.windowEndAt).getHours(), 7)
  const input = { now, nextRunAt: next.nextRunAt, lastRunAt: 0, lastRunStatus: 'parcial', startup: false, incomplete: true, hasPlan: true, running: false }
  assert.equal(schedulingDecision(input).run, false)
  assert.deepEqual(schedulingDecision({ ...input, now: next.nextRunAt }), { run: true, reschedule: true, until: next.windowEndAt })
  const morning = new Date(2026, 9, 15, 8, 10).getTime()
  const catchUp = schedulingDecision({ ...input, now: morning, nextRunAt: schedule(morning).nextRunAt, startup: true })
  assert.equal(catchUp.run, true); assert.equal(catchUp.until, 0)
  assert.equal(schedulingDecision({ ...input, now: next.nextRunAt, running: true }).run, false)
  assert.equal(schedulingDecision({ ...input, startup: true, incomplete: false }).run, false)
})
