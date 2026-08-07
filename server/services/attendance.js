/**
 * Attendance engine: the event-log math over work_sessions rows, plus
 * finalization — the "end-of-day job", implemented
 * lazily. The requirements ask for a cron/scheduled task that closes open
 * sessions at midnight and applies the 8-hour rule. Serverless (Vercel) has
 * no always-on process, so instead we finalize *on read*: whenever
 * attendance data is fetched, any still-open session from a PAST day is
 * auto-closed first. This is idempotent and gives the same end result
 * without a background worker.
 *
 * A standalone runner (server/jobs/finalize.js) can also call this from cron
 * for deployments that do have a scheduler.
 *
 * One work session per employee per calendar day (Zoho-style check-in
 * timer). The source of truth is the ordered `events` jsonb log — NOT a
 * running counter. Worked time is always *computed* from these events, so
 * the timer is refresh-proof and re-login-proof.
 *
 *   check_in  -> starts a running interval
 *   pause     -> ends the current running interval (break — not counted)
 *   resume    -> starts a new running interval
 *   check_out -> ends the current interval and finalizes the day (manual)
 *   auto_close-> ends the day automatically at EOD if the user forgot to check out
 */
import { q } from '../db.js'
import { FULL_WORKDAY_SECONDS } from '../config.js'
import { dayKey, endOfDay, weekStartOf } from '../utils/time.js'

/**
 * Compute worked seconds from the event log up to `upto` (default: now).
 * Running intervals are opened by check_in/resume and closed by
 * pause/check_out/auto_close. A still-open interval is measured up to `upto`.
 */
export function computeWorkedSeconds(events, upto = Date.now()) {
  let total = 0
  let openAt = null
  for (const ev of events) {
    const t = new Date(ev.at).getTime()
    if (ev.type === 'check_in' || ev.type === 'resume') {
      if (openAt === null) openAt = t
    } else if (ev.type === 'pause' || ev.type === 'check_out' || ev.type === 'auto_close') {
      if (openAt !== null) {
        total += Math.max(0, t - openAt)
        openAt = null
      }
    }
  }
  if (openAt !== null) total += Math.max(0, upto - openAt)
  return Math.floor(total / 1000)
}

/** Is the timer currently running (checked in and not paused)? */
export function isRunning(events) {
  let running = false
  for (const ev of events) {
    if (ev.type === 'check_in' || ev.type === 'resume') running = true
    else if (ev.type === 'pause' || ev.type === 'check_out' || ev.type === 'auto_close')
      running = false
  }
  return running
}

/** work_sessions row → live, computed view for the API (status + elapsed seconds). */
export function liveSessionJSON(row, now = Date.now()) {
  const events = row.events || []
  const open = row.status === 'active'
  const running = open && isRunning(events)
  const workedSeconds = open ? computeWorkedSeconds(events, now) : row.worked_seconds
  const firstIn = events.find((e) => e.type === 'check_in')
  const lastOut = [...events].reverse().find((e) => e.type === 'check_out' || e.type === 'auto_close')
  return {
    date: row.date,
    // timerState drives the UI button: 'out' (not started), 'running', 'paused', 'done'.
    timerState: !open ? 'done' : running ? 'running' : events.length ? 'paused' : 'out',
    running,
    workedSeconds,
    fullDaySeconds: FULL_WORKDAY_SECONDS,
    status: row.status,
    dayStatus: row.day_status,
    checkInAt: firstIn ? firstIn.at : null,
    checkOutAt: lastOut ? lastOut.at : null,
  }
}

/** Apply the 8h rule to a finalized worked-seconds total. */
export function verdictFor(workedSeconds) {
  return workedSeconds >= FULL_WORKDAY_SECONDS ? 'present' : 'leave'
}

/**
 * Close a single open session as of the end of its own day. Persists and
 * returns the updated row. If the timer was still running, an `auto_close`
 * event is appended at EOD so the accumulated time (and nothing after) is
 * what gets recorded.
 */
export async function finalizeSession(row) {
  const events = [...(row.events || [])]
  const running = ['check_in', 'resume'].includes(events[events.length - 1]?.type)
  if (running) {
    events.push({ type: 'auto_close', at: endOfDay(row.date).toISOString() })
  }
  const workedSeconds = computeWorkedSeconds(events, endOfDay(row.date).getTime())
  const { rows } = await q(
    `update work_sessions
       set events = $1, worked_seconds = $2, day_status = $3, status = 'auto_closed'
     where id = $4
     returning *`,
    [JSON.stringify(events), workedSeconds, verdictFor(workedSeconds), row.id],
  )
  return rows[0]
}

/**
 * Auto-close every still-open session that belongs to a day before today.
 * Scoped to one user when `userId` is given, otherwise the whole company
 * (used by the cron runner).
 */
export async function finalizeStaleSessions(userId = null) {
  const today = dayKey()
  const { rows: stale } = await q(
    `select * from work_sessions where status = 'active' and date < $1
       ${userId ? 'and user_id = $2' : ''}`,
    userId ? [today, userId] : [today],
  )
  for (const session of stale) await finalizeSession(session)
  return stale.length
}

/**
 * Summary KPIs for the attendance analytics page, derived from a list of
 * live-view sessions (`liveSessionJSON()` shape, any order). Only *finalized*
 * days (status !== 'active') count toward totals/streaks — today's
 * still-running session has no verdict yet, so including it would make
 * "present days" or a streak flicker based on the time of day the page
 * happens to load.
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
