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
import { approvedFullDayLeaveOn, approvedFullDayLeavesOn } from '../services/leavePolicy.js'
import { captureCheckInOrigin } from '../services/geoip.js'
import { recordActivity } from '../services/activityLog.js'
import { descendantIds } from '../services/hierarchy.js'
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

/**
 * Append an event to today's session, enforcing valid state transitions.
 * `origin` (captureCheckInOrigin's shape) is only meaningful for a check_in —
 * every other action passes null, which leaves the stored origin untouched so
 * a pause or check-out can never overwrite where the day actually started.
 */
async function appendEvent(userId, type, origin = null) {
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

  // coalesce keeps the existing origin whenever `origin` is null (every
  // non-check-in action), so the columns are written exactly once per day.
  const { rows } = await q(
    `update work_sessions
       set events = $1, worked_seconds = $2, day_status = $3, status = $4,
           check_in_ip = coalesce($6, check_in_ip),
           check_in_city = coalesce($7, check_in_city),
           check_in_region = coalesce($8, check_in_region),
           check_in_country = coalesce($9, check_in_country),
           check_in_country_code = coalesce($10, check_in_country_code)
     where id = $5
     returning *`,
    [
      JSON.stringify(events),
      workedSeconds,
      dayStatus,
      status,
      session.id,
      origin?.ip ?? null,
      origin ? origin.city : null,
      origin ? origin.region : null,
      origin ? origin.country : null,
      origin ? origin.countryCode : null,
    ],
  )
  return rows[0]
}

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/**
 * Someone on approved full-day leave today can't check in (either way) — the
 * day is already accounted for as leave, and marking it present too would
 * count it twice. Half-day and shorter leave don't block: there's still a
 * part of the day to work. Throws the 409 the check-in routes surface.
 */
async function assertNotOnLeaveToday(userId) {
  const leave = await approvedFullDayLeaveOn(userId, dayKey())
  if (leave) {
    throw httpError(
      409,
      `You're on approved ${leave.label} today — check-in isn't available on a leave day.`,
    )
  }
}

/**
 * GET /api/attendance/today — live status + elapsed seconds for today, plus
 * `onLeave` (the approved full-day leave covering today, or null) so the
 * dashboard can grey out check-in with the reason instead of letting the
 * server's rejection be the first hint.
 */
router.get('/today', async (req, res, next) => {
  try {
    const [session, onLeave] = await Promise.all([
      getTodaySession(req.user.id),
      approvedFullDayLeaveOn(req.user.id, dayKey()),
    ])
    if (!session) {
      return res.json({
        timerState: 'out',
        running: false,
        workedSeconds: 0,
        dayStatus: null,
        checkInAt: null,
        checkOutAt: null,
        onLeave,
      })
    }
    res.json({ ...liveSessionJSON(session), onLeave })
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
    await assertNotOnLeaveToday(req.user.id)
    const origin = await captureCheckInOrigin(req)
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
         set events = $1, worked_seconds = $2, day_status = 'present', status = 'completed',
             check_in_ip = $4, check_in_city = $5, check_in_region = $6,
             check_in_country = $7, check_in_country_code = $8
       where id = $3 and status = 'active'
       returning *`,
      [
        JSON.stringify(events),
        FULL_WORKDAY_SECONDS,
        session.id,
        origin.ip,
        origin.city,
        origin.region,
        origin.country,
        origin.countryCode,
      ],
    )
    if (!rows[0]) throw httpError(409, 'Attendance for today is already recorded.')
    recordActivity(req, 'attendance.checked_in', {
      targetType: 'attendance',
      targetName: rows[0].date,
      description:
        `${req.user.name} checked in for the day (one-tap, marked present)` +
        `${origin.city ? ` from ${origin.city}` : ''}.`,
    })
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
    let origin = null
    if (type === 'check_in') {
      const settings = await cachedAppSettings()
      if (!settings.attendance_timer_enabled) {
        return res
          .status(403)
          .json({ error: 'The check-in timer is currently turned off by your admin.' })
      }
      await assertNotOnLeaveToday(req.user.id)
      origin = await captureCheckInOrigin(req)
    }
    const session = await appendEvent(req.user.id, type, origin)
    // Only the two ends of the day are activities; pause/resume would bury the
    // trail in noise without telling an HR admin anything they'd act on.
    const live = liveSessionJSON(session)
    if (type === 'check_in') {
      recordActivity(req, 'attendance.checked_in', {
        targetType: 'attendance',
        targetName: live.date,
        description:
          `${req.user.name} started their day on the check-in timer` +
          `${origin?.city ? ` from ${origin.city}` : ''}.`,
      })
    } else if (type === 'check_out') {
      const hours = Math.floor(live.workedSeconds / 3600)
      const mins = Math.floor((live.workedSeconds % 3600) / 60)
      recordActivity(req, 'attendance.checked_out', {
        targetType: 'attendance',
        targetName: live.date,
        description:
          `${req.user.name} checked out after ${hours}h ${String(mins).padStart(2, '0')}m ` +
          `(${live.dayStatus === 'present' ? 'marked present' : 'short day — auto-leave'}).`,
      })
    }
    res.json(live)
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
 * GET /api/attendance/daily?date=YYYY-MM-DD — the daily check-in roll-call
 * behind the check-in card's team panel. Manager and admin only, and the two
 * see deliberately different sets:
 *
 *   admin   — everyone in the company
 *   manager — only their own reporting subtree (direct + indirect reports)
 *
 * The scope is decided HERE, from req.user, never from anything the client
 * sends: a manager cannot widen it to the company by editing a request.
 *
 * Returns one row per person in scope — including those who have NOT checked
 * in, which is the point of a roll-call — each carrying the check-in time,
 * worked time, verdict, and where the check-in came from (IP + city/country).
 * The viewer themselves is left out: their own status is the check-in card
 * this panel hangs under.
 */
router.get('/daily', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'You do not have access to this resource.' })
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : dayKey()
    const isAdmin = req.user.role === 'admin'

    // Invited accounts have never signed in, so they can't have attendance —
    // listing them would only pad the "absent" count with people who don't
    // have a login yet. Deliberately NOT selecting photo_url: profile photos
    // are inline data URLs up to ~1.4MB each, and this list loads with the
    // dashboard — the roll-call shows initials instead.
    const { rows: people } = isAdmin
      ? await q(
          `select id, name, department, designation from users
            where status = 'active' and id <> $1 order by name`,
          [req.user.id],
        )
      : await q(
          `select id, name, department, designation from users
            where status = 'active' and id = any($1::uuid[]) order by name`,
          [await descendantIds(req.user.id)],
        )

    if (!people.length) {
      return res.json({
        date,
        scope: isAdmin ? 'company' : 'team',
        summary: { total: 0, checkedIn: 0, onLeave: 0, absent: 0 },
        rows: [],
      })
    }

    const ids = people.map((p) => p.id)
    await finalizeStaleSessions()
    const [{ rows: sessions }, leaveByUser] = await Promise.all([
      q('select * from work_sessions where date = $1 and user_id = any($2::uuid[])', [date, ids]),
      approvedFullDayLeavesOn(ids, date),
    ])
    const sessionByUser = new Map(sessions.map((s) => [s.user_id, s]))

    const rows = people.map((p) => {
      const session = sessionByUser.get(p.id)
      const live = session ? liveSessionJSON(session) : null
      return {
        employeeId: p.id,
        employeeName: p.name,
        department: p.department ?? '',
        designation: p.designation ?? '',
        date,
        checkedIn: Boolean(live?.checkInAt),
        onLeave: leaveByUser.get(p.id) ?? null,
        ...(live ?? {
          timerState: 'out',
          running: false,
          workedSeconds: 0,
          status: null,
          dayStatus: null,
          checkInAt: null,
          checkOutAt: null,
          checkInIp: null,
          checkInCity: '',
          checkInCountry: '',
          checkInCountryCode: '',
          checkInLocation: '',
        }),
      }
    })

    // Reads like an arrival log: whoever checked in first at the top, then
    // everyone still missing, alphabetically.
    rows.sort((a, b) => {
      if (a.checkInAt && b.checkInAt) return new Date(a.checkInAt) - new Date(b.checkInAt)
      if (a.checkInAt || b.checkInAt) return a.checkInAt ? -1 : 1
      return a.employeeName.localeCompare(b.employeeName)
    })

    const checkedIn = rows.filter((r) => r.checkedIn).length
    const onLeave = rows.filter((r) => !r.checkedIn && r.onLeave).length
    res.json({
      date,
      scope: isAdmin ? 'company' : 'team',
      summary: { total: rows.length, checkedIn, onLeave, absent: rows.length - checkedIn - onLeave },
      rows,
    })
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
