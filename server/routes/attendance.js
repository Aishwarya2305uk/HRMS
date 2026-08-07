import { Router } from 'express'
import { q } from '../db.js'
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
