/**
 * Attendance finalization — the "end-of-day job", implemented lazily.
 *
 * The requirements ask for a cron/scheduled task that closes open sessions at
 * midnight and applies the 8-hour rule. Serverless (Vercel) has no always-on
 * process, so instead we finalize *on read*: whenever attendance data is
 * fetched, any still-open session from a PAST day is auto-closed first. This
 * is idempotent and gives the same end result without a background worker.
 *
 * A standalone runner (server/jobs/finalize.js) can also call this from cron
 * for deployments that do have a scheduler.
 */
import { WorkSession, computeWorkedSeconds } from '../models/WorkSession.js'
import { FULL_WORKDAY_SECONDS } from '../config.js'
import { dayKey, endOfDay } from '../utils/time.js'

/** Apply the 8h rule to a finalized worked-seconds total. */
export function verdictFor(workedSeconds) {
  return workedSeconds >= FULL_WORKDAY_SECONDS ? 'present' : 'leave'
}

/**
 * Close a single open session as of the end of its own day. Mutates + saves.
 * If the timer was still running, an `auto_close` event is appended at EOD so
 * the accumulated time (and nothing after) is what gets recorded.
 */
export async function finalizeSession(session) {
  const running = ['check_in', 'resume'].includes(
    session.events[session.events.length - 1]?.type,
  )
  if (running) {
    session.events.push({ type: 'auto_close', at: endOfDay(session.date) })
  }
  session.workedSeconds = computeWorkedSeconds(session.events, endOfDay(session.date).getTime())
  session.dayStatus = verdictFor(session.workedSeconds)
  session.status = 'auto_closed'
  await session.save()
  return session
}

/**
 * Auto-close every still-open session that belongs to a day before today.
 * Scoped to one user when `userId` is given, otherwise the whole company
 * (used by the cron runner).
 */
export async function finalizeStaleSessions(userId = null) {
  const today = dayKey()
  const query = { status: 'active', date: { $lt: today } }
  if (userId) query.userId = userId
  const stale = await WorkSession.find(query)
  for (const session of stale) await finalizeSession(session)
  return stale.length
}
