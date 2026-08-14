import { Router } from 'express'
import { q } from '../db.js'
import { cachedAppSettings } from '../cache.js'
import { FULL_WORKDAY_SECONDS } from '../config.js'
import { requireAuth } from '../middleware/auth.js'
import {
  finalizeStaleSessions,
  verdictFor,
  summarizeAttendance,
  bucketWeekly,
  computeWorkedSeconds,
  isRunning,
  liveSessionJSON,
} from '../services/attendance.js'
import { dayKey } from '../utils/time.js'

/** Rolling window for the analytics endpoint — long enough for a meaningful
 *  trend/streak view, short enough to keep the query and payload small. */
const ANALYTICS_WINDOW_DAYS = 90

const router = Router()
router.use(requireAuth)

/**
 * Load (or create) today's session for the current user, after first closing
 * any stale open sessions from previous days. Returns the raw row.
 */
async function getTodaySession(userId, { create = false } = {}) {
  await finalizeStaleSessions(userId)
  const date = dayKey()
  let { rows } = await q('select * from work_sessions where user_id = $1 and date = $2', [
    userId,
    date,
  ])
  if (!rows[0] && create) {
    ;({ rows } = await q(
      `insert into work_sessions (user_id, date) values ($1, $2)
       on conflict (user_id, date) do update set user_id = excluded.user_id
       returning *`,
      [userId, date],
    ))
  }
  return rows[0] ?? null
}

/** Append an event to today's session, enforcing valid state transitions. */
async function appendEvent(userId, type) {
  const session = await getTodaySession(userId, { create: type === 'check_in' })

  const events = [...(session?.events || [])]
  if (type === 'check_in') {
    if (events.some((e) => e.type === 'check_in')) {
      throw httpError(409, 'You have already checked in today.')
    }
    // e.g. the day was already recorded via the one-tap "Check in for today".
    if (session.status !== 'active') {
      throw httpError(409, 'Attendance for today is already recorded.')
    }
  } else {
    if (!session || session.status !== 'active') {
      throw httpError(409, 'You need to check in first.')
    }
    const running = isRunning(events)
    if (type === 'pause' && !running) throw httpError(409, 'Timer is not running.')
    if (type === 'resume' && running) throw httpError(409, 'Timer is already running.')
  }

  events.push({ type, at: new Date().toISOString() })

  // Manual check-out finalizes the day immediately (8h rule applies).
  let workedSeconds = session.worked_seconds
  let dayStatus = session.day_status
  let status = session.status
  if (type === 'check_out') {
    workedSeconds = computeWorkedSeconds(events, Date.now())
    dayStatus = verdictFor(workedSeconds)
    status = 'completed'
  }

  const { rows } = await q(
    `update work_sessions
       set events = $1, worked_seconds = $2, day_status = $3, status = $4
     where id = $5
     returning *`,
    [JSON.stringify(events), workedSeconds, dayStatus, status, session.id],
  )
  return rows[0]
}

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/** GET /api/attendance/today — live status + elapsed seconds for today. */
router.get('/today', async (req, res, next) => {
  try {
    const session = await getTodaySession(req.user.id)
    if (!session) {
      return res.json({
        timerState: 'out',
        running: false,
        workedSeconds: 0,
        dayStatus: null,
        checkInAt: null,
        checkOutAt: null,
      })
    }
    res.json(liveSessionJSON(session))
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/attendance/day-checkin — the one-tap alternative to the timer:
 * marks today as a full present day, crediting FULL_WORKDAY_SECONDS in one
 * click. No timer runs; the day finalizes immediately. Kept as its own event
 * type (`day_check_in`) so timer math never confuses it with a real interval.
 *
 * Which attendance methods are available is an admin setting (Other
 * Settings); this route and the timer's check-in both re-check their flag
 * server-side, so a hidden method can't be driven from a stale client.
 * NOTE: registered before '/:action' so Express doesn't treat it as one.
 */
router.post('/day-checkin', async (req, res, next) => {
  try {
    const settings = await cachedAppSettings()
    if (!settings.attendance_quick_checkin_enabled) {
      return res
        .status(403)
        .json({ error: '"Check in for today" is currently turned off by your admin.' })
    }
    const session = await getTodaySession(req.user.id, { create: true })
    if (session.status !== 'active' || (session.events || []).length > 0) {
      throw httpError(
        409,
        (session.events || []).some((e) => e.type === 'check_in')
          ? 'You already checked in with the timer today.'
          : 'Attendance for today is already recorded.',
      )
    }
    const events = [{ type: 'day_check_in', at: new Date().toISOString() }]
    // `status = 'active'` in the WHERE guards a double-tap race: the loser
    // matches zero rows instead of overwriting the finalized day.
    const { rows } = await q(
      `update work_sessions
         set events = $1, worked_seconds = $2, day_status = 'present', status = 'completed'
       where id = $3 and status = 'active'
       returning *`,
      [JSON.stringify(events), FULL_WORKDAY_SECONDS, session.id],
    )
    if (!rows[0]) throw httpError(409, 'Attendance for today is already recorded.')
    res.json(liveSessionJSON(rows[0]))
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

/** POST /api/attendance/:action — action ∈ check-in | pause | resume | check-out. */
const ACTIONS = {
  'check-in': 'check_in',
  pause: 'pause',
  resume: 'resume',
  'check-out': 'check_out',
}
router.post('/:action', async (req, res, next) => {
  try {
    const type = ACTIONS[req.params.action]
    if (!type) return res.status(404).json({ error: 'Unknown attendance action.' })
    // Only STARTING a timer day is gated on the admin toggle — pause/resume/
    // check-out must keep working so hiding the timer mid-day never strands
    // someone in a session they can't finish.
    if (type === 'check_in') {
      const settings = await cachedAppSettings()
      if (!settings.attendance_timer_enabled) {
        return res
          .status(403)
          .json({ error: 'The check-in timer is currently turned off by your admin.' })
      }
    }
    const session = await appendEvent(req.user.id, type)
    res.json(liveSessionJSON(session))
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

/**
 * GET /api/attendance/history — the user's finalized + in-progress days.
 * Newest first; each row has date, check-in/out, worked hours and day status.
 */
router.get('/history', async (req, res, next) => {
  try {
    await finalizeStaleSessions(req.user.id)
    const { rows } = await q(
      'select * from work_sessions where user_id = $1 order by date desc limit 60',
      [req.user.id],
    )
    res.json(rows.map((s) => liveSessionJSON(s)))
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/attendance/analytics — the current user's own attendance
 * analytics over a fixed rolling window: summary KPIs (worked hours,
 * present/short days, streaks), a per-day series, and a weekly total for a
 * trend chart. Always scoped to req.user — there is no way to request
 * another employee's analytics through this endpoint.
 */
router.get('/analytics', async (req, res, next) => {
  try {
    await finalizeStaleSessions(req.user.id)
    const to = dayKey()
    const from = dayKey(new Date(Date.now() - (ANALYTICS_WINDOW_DAYS - 1) * 86400000))
    const { rows } = await q(
      'select * from work_sessions where user_id = $1 and date between $2 and $3 order by date',
      [req.user.id, from, to],
    )

    const daily = rows.map((s) => liveSessionJSON(s))
    const summary = summarizeAttendance(daily, { monthKey: to.slice(0, 7) })
    const weekly = bucketWeekly(daily)

    res.json({ range: { from, to }, summary, daily, weekly })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/attendance/all?month=YYYY-MM — admin-only: every employee's
 * attendance for the given month (defaults to the current month).
 */
router.get('/all', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admins only.' })
    }
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : dayKey().slice(0, 7)
    await finalizeStaleSessions()
    const { rows } = await q(
      `select s.*, u.name as employee_name, u.department as employee_department
         from work_sessions s
         left join users u on u.id = s.user_id
        where s.date between $1 and $2
        order by s.date desc`,
      [`${month}-01`, `${month}-31`],
    )
    res.json(
      rows.map((s) => ({
        ...liveSessionJSON(s),
        employeeId: s.user_id ?? null,
        employeeName: s.employee_name ?? 'Unknown',
        department: s.employee_department ?? '',
      })),
    )
  } catch (err) {
    next(err)
  }
})

export default router
