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
import { dayKey, endOfDay, weekStartOf } from '../utils/time.js'

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

/**
 * Summary KPIs for the attendance analytics page, derived from a list of
 * live-view sessions (`toLiveJSON()` shape, any order). Only *finalized* days
 * (status !== 'active') count toward totals/streaks — today's still-running
 * session has no verdict yet, so including it would make "present days" or a
 * streak flicker based on the time of day the page happens to load.
 *
 * "Streak" counts consecutive PRESENT entries in the list itself, not
 * consecutive calendar dates — there's no concept of a company working-day
 * calendar in v1 (no weekends/holidays config), so a day with no session at
 * all (weekend, day off) simply isn't part of the sequence rather than being
 * treated as a break.
 */
export function summarizeAttendance(daily, { monthKey }) {
  const finalized = daily.filter((d) => d.status !== 'active')
  const chronological = [...finalized].sort((a, b) => (a.date < b.date ? -1 : 1))

  const presentDays = finalized.filter((d) => d.dayStatus === 'present').length
  const shortDays = finalized.filter((d) => d.dayStatus === 'leave').length
  const totalWorkedSeconds = finalized.reduce((sum, d) => sum + (d.workedSeconds || 0), 0)
  const avgWorkedSecondsPerDay = finalized.length
    ? Math.round(totalWorkedSeconds / finalized.length)
    : 0
  const bestDayWorkedSeconds = finalized.reduce((max, d) => Math.max(max, d.workedSeconds || 0), 0)
  const presentRate = finalized.length ? Math.round((presentDays / finalized.length) * 100) : null

  let longestStreak = 0
  let run = 0
  for (const d of chronological) {
    run = d.dayStatus === 'present' ? run + 1 : 0
    longestStreak = Math.max(longestStreak, run)
  }
  let currentStreak = 0
  for (let i = chronological.length - 1; i >= 0; i--) {
    if (chronological[i].dayStatus !== 'present') break
    currentStreak++
  }

  const thisMonthDays = finalized.filter((d) => d.date.startsWith(monthKey))
  const thisMonthTotal = thisMonthDays.reduce((sum, d) => sum + (d.workedSeconds || 0), 0)

  return {
    loggedDays: finalized.length,
    presentDays,
    shortDays,
    totalWorkedSeconds,
    avgWorkedSecondsPerDay,
    bestDayWorkedSeconds,
    presentRate,
    currentStreak,
    longestStreak,
    thisMonth: {
      presentDays: thisMonthDays.filter((d) => d.dayStatus === 'present').length,
      totalWorkedSeconds: thisMonthTotal,
      avgWorkedSecondsPerDay: thisMonthDays.length
        ? Math.round(thisMonthTotal / thisMonthDays.length)
        : 0,
    },
  }
}

/** Buckets finalized days into Monday-start weeks for a "hours per week" trend chart. */
export function bucketWeekly(daily) {
  const buckets = new Map()
  for (const d of daily) {
    if (d.status === 'active') continue
    const start = weekStartOf(d.date)
    const bucket = buckets.get(start) ?? {
      weekStart: start,
      totalWorkedSeconds: 0,
      presentDays: 0,
      loggedDays: 0,
    }
    bucket.totalWorkedSeconds += d.workedSeconds || 0
    bucket.loggedDays += 1
    if (d.dayStatus === 'present') bucket.presentDays += 1
    buckets.set(start, bucket)
  }
  return [...buckets.values()].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
}
