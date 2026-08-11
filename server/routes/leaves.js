import { Router } from 'express'
import { q, tx } from '../db.js'
import { cachedLeaveTypes } from '../cache.js'
import { requireAuth } from '../middleware/auth.js'
import {
  isValidId,
  leaveJSON,
  leaveTypeJSON,
  ensureLeaveBalances,
  saveLeaveBalances,
  mapUser,
} from '../store.js'
import { finalizeStaleSessions } from '../services/attendance.js'
import { dayKey, inclusiveDays, startOfDay, dateKeysInRange } from '../utils/time.js'

const router = Router()
router.use(requireAuth)

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** The join every listing uses: requester identity attached to each leave row. */
const LEAVE_WITH_USER = `
  select l.*, u.name as employee_name, u.email as employee_email, u.employee_id as employee_code
    from leaves l
    join users u on u.id = l.user_id`

/**
 * Shared "when" validation for leave and WFH applications: dates, the
 * day-part (full / first half / second half) and the working-hours window.
 * Returns { error } on the first problem, otherwise the normalized fields
 * with `days` already computed (0.5 for a half day).
 */
function parseWhen(body) {
  const { startDate, endDate, dayPart = 'full', startTime = '', endTime = '' } = body || {}
  if (!['full', 'first', 'second'].includes(dayPart)) {
    return { error: 'Invalid day selection.' }
  }
  const startKey = String(startDate || '').slice(0, 10)
  const endKey = String(endDate || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startKey) || !/^\d{4}-\d{2}-\d{2}$/.test(endKey)) {
    return { error: 'Start and end dates are required.' }
  }
  if (endKey < startKey) {
    return { error: 'End date cannot be before the start date.' }
  }
  const year = String(new Date().getFullYear())
  if (!startKey.startsWith(year) || !endKey.startsWith(year)) {
    return { error: 'Requests can only be made for dates within the current year.' }
  }
  if (dayPart !== 'full' && startKey !== endKey) {
    return { error: 'Half-day requests must start and end on the same day.' }
  }
  const start = String(startTime).trim()
  const end = String(endTime).trim()
  if ((start && !TIME_RE.test(start)) || (end && !TIME_RE.test(end))) {
    return { error: 'Times must be in HH:MM format.' }
  }
  if (start && end && startKey === endKey && end <= start) {
    return { error: 'End time must be after the start time.' }
  }
  return {
    startKey,
    endKey,
    dayPart,
    startTime: start,
    endTime: end,
    days: dayPart === 'full' ? inclusiveDays(startKey, endKey) : 0.5,
  }
}

/** Sorted, deduped 'YYYY-MM-DD' keys grouped into contiguous runs, e.g.
 *  [4th, 5th, 12th] -> [{start: 4th, end: 5th}, {start: 12th, end: 12th}]. */
function groupContiguous(keys) {
  const ranges = []
  for (const k of [...new Set(keys)].sort()) {
    const last = ranges[ranges.length - 1]
    if (last && inclusiveDays(last.end, k) === 2) last.end = k
    else ranges.push({ start: k, end: k })
  }
  return ranges
}

const MAX_CUSTOM_DATES = 31

/**
 * Custom-dates variant of parseWhen: the client sends `dates` (individual
 * 'YYYY-MM-DD' picks, not necessarily consecutive) instead of a start/end
 * range. Returns { error } or { ranges, dayPart, startTime, endTime,
 * totalDays } — one request row is created per contiguous run so the
 * existing single-range model, calendar and approval flow stay untouched.
 */
function parseCustomWhen(body) {
  const { dates, dayPart = 'full', startTime = '', endTime = '' } = body || {}
  if (!['full', 'first', 'second'].includes(dayPart)) {
    return { error: 'Invalid day selection.' }
  }
  const keys = (Array.isArray(dates) ? dates : []).map((d) => String(d || '').slice(0, 10))
  if (keys.length === 0 || keys.some((k) => !/^\d{4}-\d{2}-\d{2}$/.test(k))) {
    return { error: 'Pick at least one valid date.' }
  }
  const unique = [...new Set(keys)]
  if (unique.length > MAX_CUSTOM_DATES) {
    return { error: `Pick at most ${MAX_CUSTOM_DATES} dates per request.` }
  }
  const year = String(new Date().getFullYear())
  if (unique.some((k) => !k.startsWith(year))) {
    return { error: 'Requests can only be made for dates within the current year.' }
  }
  if (dayPart !== 'full' && unique.length > 1) {
    return { error: 'Half days can only cover a single date.' }
  }
  const start = String(startTime).trim()
  const end = String(endTime).trim()
  if ((start && !TIME_RE.test(start)) || (end && !TIME_RE.test(end))) {
    return { error: 'Times must be in HH:MM format.' }
  }
  if (start && end && end <= start) {
    return { error: 'End time must be after the start time.' }
  }
  return {
    ranges: groupContiguous(unique),
    dayPart,
    startTime: start,
    endTime: end,
    totalDays: dayPart === 'full' ? unique.length : 0.5,
  }
}

/** Insert one leave/WFH row and return it shaped, with the requester's identity attached. */
async function insertRequest(user, fields) {
  const { rows } = await q(
    `insert into leaves (user_id, kind, type, start_date, end_date, day_part, start_time,
                         end_time, days, reason, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
     returning *`,
    [
      user.id,
      fields.kind,
      fields.type ?? null,
      fields.startDate,
      fields.endDate,
      fields.dayPart,
      fields.startTime,
      fields.endTime,
      fields.days,
      fields.reason,
    ],
  )
  // so the response carries name/email/employeeId
  return leaveJSON({
    ...rows[0],
    employee_name: user.name,
    employee_email: user.email,
    employee_code: user.employeeId,
  })
}

/** GET /api/leaves/config — active leave types (so the UI stays in sync with
 *  whatever admin currently has configured — see routes/leaveTypes.js). */
router.get('/config', async (_req, res, next) => {
  try {
    const rows = await cachedLeaveTypes()
    res.json({ types: rows.filter((t) => t.active).map(leaveTypeJSON) })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/leaves — apply for leave.
 * Body: { type, startDate, endDate, reason }
 * Validates the range and that the current balance covers the request.
 */
router.post('/', async (req, res, next) => {
  try {
    const { type, reason = '' } = req.body || {}
    const { rows: typeRows } = await q(
      'select * from leave_types where key = $1 and active',
      [String(type || '')],
    )
    const leaveType = typeRows[0]
    if (!leaveType) {
      return res.status(400).json({ error: 'Please choose a valid leave type.' })
    }

    // Custom-dates mode: individual (possibly scattered) dates instead of a
    // range. Each contiguous run becomes its own request; the balance is
    // checked against the TOTAL up front so a batch can never half-succeed
    // into an over-drawn balance.
    const custom = Array.isArray(req.body?.dates) && req.body.dates.length > 0
    const when = custom ? parseCustomWhen(req.body) : parseWhen(req.body)
    if (when.error) return res.status(400).json({ error: when.error })
    const totalDays = custom ? when.totalDays : when.days

    await ensureLeaveBalances(req.user)
    const remaining = Number(req.user.leaveBalances[type]) || 0
    if (totalDays > remaining) {
      return res.status(400).json({
        error: `Insufficient ${leaveType.label} balance — you have ${remaining} day(s) left but requested ${totalDays}.`,
      })
    }

    const ranges = custom ? when.ranges : [{ start: when.startKey, end: when.endKey }]
    const created = []
    for (const r of ranges) {
      created.push(
        await insertRequest(req.user, {
          kind: 'leave',
          type,
          startDate: startOfDay(r.start),
          endDate: startOfDay(r.end),
          dayPart: when.dayPart,
          startTime: when.startTime,
          endTime: when.endTime,
          days: when.dayPart === 'full' ? inclusiveDays(r.start, r.end) : 0.5,
          reason: String(reason).trim(),
        }),
      )
    }
    // Range mode keeps its original single-object shape; custom mode returns
    // the whole batch (one entry per contiguous run).
    res.status(201).json(custom ? created : created[0])
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/leaves/wfh — request to work from home for a date range.
 * Unlike leave, this never touches any balance and always requires a reason
 * (there's no quota to fall back on, so the approving manager needs context).
 */
router.post('/wfh', async (req, res, next) => {
  try {
    const { reason = '' } = req.body || {}
    const trimmedReason = String(reason).trim()
    if (!trimmedReason) {
      return res.status(400).json({ error: 'Please add a reason for working from home.' })
    }
    if (trimmedReason.length > 500) {
      return res.status(400).json({ error: 'Reason must be under 500 characters.' })
    }

    // Same custom-dates handling as leave above — WFH just skips balances.
    const custom = Array.isArray(req.body?.dates) && req.body.dates.length > 0
    const when = custom ? parseCustomWhen(req.body) : parseWhen(req.body)
    if (when.error) return res.status(400).json({ error: when.error })

    const ranges = custom ? when.ranges : [{ start: when.startKey, end: when.endKey }]
    const created = []
    for (const r of ranges) {
      created.push(
        await insertRequest(req.user, {
          kind: 'wfh',
          startDate: startOfDay(r.start),
          endDate: startOfDay(r.end),
          dayPart: when.dayPart,
          startTime: when.startTime,
          endTime: when.endTime,
          days: when.dayPart === 'full' ? inclusiveDays(r.start, r.end) : 0.5,
          reason: trimmedReason,
        }),
      )
    }
    res.status(201).json(custom ? created : created[0])
  } catch (err) {
    next(err)
  }
})

/** GET /api/leaves/mine — the current user's own applications (newest first). */
router.get('/mine', async (req, res, next) => {
  try {
    const { rows } = await q(`${LEAVE_WITH_USER} where l.user_id = $1 order by l.created_at desc`, [
      req.user.id,
    ])
    res.json(rows.map(leaveJSON))
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/leaves/regularize — "I checked out early by mistake": ask your
 * manager to count a short (auto-leave) attendance day as present.
 * Body: { date: 'YYYY-MM-DD', reason }. Reason is required — the manager is
 * being asked to overrule the 8-hour rule and needs to know why. One open
 * request per day; approval flips that work_sessions row's day_status to
 * 'present' (see /:id/approve).
 */
router.post('/regularize', async (req, res, next) => {
  try {
    const dateKey = String(req.body?.date || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return res.status(400).json({ error: 'A valid date is required.' })
    }
    if (dateKey > dayKey()) {
      return res.status(400).json({ error: 'Only days that already happened can be regularized.' })
    }
    const reason = String(req.body?.reason || '').trim().slice(0, 500)
    if (!reason) {
      return res.status(400).json({ error: 'Please add a short reason — your manager sees it with the request.' })
    }

    // Close any stale open sessions first so a past day carries its verdict
    // before we judge whether it needs fixing.
    await finalizeStaleSessions(req.user.id)
    const { rows: sessions } = await q(
      'select * from work_sessions where user_id = $1 and date = $2',
      [req.user.id, dateKey],
    )
    const session = sessions[0]
    if (!session || session.status === 'active') {
      return res.status(400).json({ error: 'That day has no finished attendance to fix yet.' })
    }
    if (session.day_status === 'present') {
      return res.status(409).json({ error: 'That day already counts as present.' })
    }

    const { rows: dupes } = await q(
      `select 1 from leaves
        where user_id = $1 and kind = 'regularize' and start_date = $2
          and status in ('pending', 'approved')`,
      [req.user.id, startOfDay(dateKey)],
    )
    if (dupes.length) {
      return res.status(409).json({ error: 'A fix request for that day is already open.' })
    }

    const created = await insertRequest(req.user, {
      kind: 'regularize',
      type: null,
      startDate: startOfDay(dateKey),
      endDate: startOfDay(dateKey),
      dayPart: 'full',
      startTime: '',
      endTime: '',
      days: 1,
      reason,
    })
    res.status(201).json(created)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/leaves/pending — the approval queue. A manager gets PENDING leaves
 * from their DIRECT REPORTS only; an admin gets the whole org's pending queue
 * (they may decide any request — see loadDecidableLeave). Backend-enforced so
 * no one can peek at others'.
 */
router.get('/pending', async (req, res, next) => {
  try {
    if (!['manager', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only managers can view approvals.' })
    }
    const { rows } =
      req.user.role === 'admin'
        ? await q(`${LEAVE_WITH_USER} where l.status = 'pending' order by l.created_at`)
        : await q(
            `${LEAVE_WITH_USER} where u.manager_id = $1 and l.status = 'pending' order by l.created_at`,
            [req.user.id],
          )
    res.json(rows.map(leaveJSON))
  } catch (err) {
    next(err)
  }
})

/**
 * Shared guard: the acting user must be the leave owner's direct manager, or
 * an admin — who may decide ANY pending request (this also covers requests
 * that would otherwise be stuck: owners with no manager assigned, or whose
 * manager has left). Runs on the given client so approve can hold it inside
 * its transaction.
 */
async function loadDecidableLeave(req, client) {
  if (!isValidId(req.params.id)) {
    throw Object.assign(new Error('Leave not found.'), { status: 404 })
  }
  const { rows } = await client.query(
    `select l.*, u.manager_id as owner_manager_id
       from leaves l
       join users u on u.id = l.user_id
      where l.id = $1`,
    [req.params.id],
  )
  const leave = rows[0]
  if (!leave) throw Object.assign(new Error('Leave not found.'), { status: 404 })
  if (leave.status !== 'pending') {
    throw Object.assign(new Error('This leave has already been decided.'), { status: 409 })
  }
  const isDirectManager = leave.owner_manager_id && leave.owner_manager_id === req.user.id
  if (!isDirectManager && req.user.role !== 'admin') {
    throw Object.assign(
      new Error('You can only act on leaves of your direct reports.'),
      { status: 403 },
    )
  }
  return leave
}

/** Re-select a decided leave with the requester's identity for the response. */
async function shapedLeave(id) {
  const { rows } = await q(`${LEAVE_WITH_USER} where l.id = $1`, [id])
  return leaveJSON(rows[0])
}

/**
 * POST /api/leaves/:id/approve — approve. For kind: 'leave' this also deducts
 * the balance; kind: 'wfh' skips that entirely (a location change, not time
 * off — there's no balance to deduct from).
 *
 * The whole decision runs in ONE transaction: the conditional balance
 * deduction and the pending -> approved flip commit together or not at all.
 * The deduction's WHERE clause still requires the balance to cover the request
 * at write time, so two simultaneous approvals can never overdraw.
 */
router.post('/:id/approve', async (req, res, next) => {
  try {
    const result = await tx(async (client) => {
      const leave = await loadDecidableLeave(req, client)

      if (leave.kind === 'leave') {
        const { rows: userRows } = await client.query(
          'select * from users where id = $1 for update',
          [leave.user_id],
        )
        const employee = mapUser(userRows[0])
        // Normally the balance key already exists (seeded at hire / first
        // request) — ensure fills any gap from types added since.
        const { changed } = await ensureLeaveBalances(employee)
        if (changed) await saveLeaveBalances(employee.id, employee.leaveBalances, client)

        // Conditional deduction: succeeds only if the balance STILL covers
        // the request at write time.
        const { rowCount } = await client.query(
          `update users
              set leave_balances = leave_balances ||
                    jsonb_build_object($1::text, coalesce((leave_balances->>$1)::numeric, 0) - $2::numeric)
            where id = $3
              and coalesce((leave_balances->>$1)::numeric, 0) >= $2::numeric`,
          [leave.type, leave.days, leave.user_id],
        )
        if (!rowCount) {
          const remaining = Number(employee.leaveBalances[leave.type]) || 0
          return {
            status: 400,
            error: `Cannot approve — employee only has ${remaining} day(s) of that leave left.`,
          }
        }
      }

      if (leave.kind === 'regularize') {
        // The whole point of this request kind: the short day now counts as
        // worked. Committed together with the approval below or not at all.
        await client.query(
          `update work_sessions set day_status = 'present'
            where user_id = $1 and date = $2`,
          [leave.user_id, dayKey(leave.start_date)],
        )
      }

      const { rows: decided } = await client.query(
        `update leaves
            set status = 'approved', approver_id = $1, decided_at = now()
          where id = $2 and status = 'pending'
          returning id`,
        [req.user.id, leave.id],
      )
      if (!decided.length) {
        // A concurrent decision won the race — rolling back also undoes the
        // deduction above.
        throw Object.assign(new Error('This leave has already been decided.'), { status: 409 })
      }
      return { id: decided[0].id }
    })

    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(await shapedLeave(result.id))
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

/** POST /api/leaves/:id/reject — reject (no balance change). Optional comment. */
router.post('/:id/reject', async (req, res, next) => {
  try {
    const decided = await tx(async (client) => {
      const leave = await loadDecidableLeave(req, client)
      // Same atomic pending -> decided flip as approve: a lost race means a
      // concurrent approval already deducted — never silently overwrite it.
      const { rows } = await client.query(
        `update leaves
            set status = 'rejected', approver_id = $1, decided_at = now(), decision_comment = $2
          where id = $3 and status = 'pending'
          returning id`,
        [req.user.id, String(req.body?.comment || '').trim(), leave.id],
      )
      if (!rows.length) {
        throw Object.assign(new Error('This leave has already been decided.'), { status: 409 })
      }
      return rows[0]
    })
    res.json(await shapedLeave(decided.id))
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

/**
 * DELETE /api/leaves/:id — cancel one of the CURRENT USER's own requests.
 *  - pending: deleted outright (free — balance is only deducted on approval).
 *    Response: { id, removed: true }.
 *  - approved, not yet started: flips to 'cancelled' (kept for the record,
 *    with the owner's optional reason from the body) and refunds the balance
 *    for kind 'leave' in the same transaction. Response: the updated leave.
 * Once the start date arrives, an approved request can no longer be cancelled.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid leave id.' })
    }
    const { rows } = await q('select * from leaves where id = $1', [req.params.id])
    const leave = rows[0]
    if (!leave) return res.status(404).json({ error: 'Leave request not found.' })
    if (leave.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only cancel your own leave requests.' })
    }

    if (leave.status === 'pending') {
      // Guarded on status so a concurrent approval can't be cancelled from
      // under its already-deducted balance.
      const { rowCount } = await q("delete from leaves where id = $1 and status = 'pending'", [
        leave.id,
      ])
      if (!rowCount) {
        return res.status(409).json({ error: 'This request was just decided — refresh to see its status.' })
      }
      return res.json({ id: req.params.id, removed: true })
    }

    if (leave.status !== 'approved') {
      return res.status(409).json({ error: 'Only pending or approved requests can be cancelled.' })
    }

    const reason = String(req.body?.reason || '').trim().slice(0, 300)
    const cancelled = await tx(async (client) => {
      // Atomic flip, guarded so it only succeeds while STILL approved and the
      // leave hasn't started — losing a race (or cancelling too late) must
      // never trigger the refund below.
      const { rows: flipped } = await client.query(
        `update leaves
            set status = 'cancelled', cancel_reason = $1, cancelled_at = now()
          where id = $2 and status = 'approved' and start_date > now()
          returning id`,
        [reason, leave.id],
      )
      if (!flipped.length) {
        throw Object.assign(
          new Error('An approved request can only be cancelled before its start date.'),
          { status: 409 },
        )
      }
      // Give the days back — approval deducted them (kind 'wfh' never did).
      if (leave.kind === 'leave') {
        await client.query(
          `update users
              set leave_balances = leave_balances ||
                    jsonb_build_object($1::text, coalesce((leave_balances->>$1)::numeric, 0) + $2::numeric)
            where id = $3`,
          [leave.type, leave.days, leave.user_id],
        )
      }
      return flipped[0]
    })
    res.json(await shapedLeave(cancelled.id))
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

/** GET /api/leaves/all — admin-only: every leave across the company. */
router.get('/all', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admins only.' })
    }
    const { rows } = await q(`${LEAVE_WITH_USER} order by l.created_at desc`)
    res.json(rows.map(leaveJSON))
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/leaves/calendar?month=YYYY-MM
 * Company-wide availability: for each day in the month, who is on APPROVED
 * leave, plus the current user's own leaves (any status) so they can see their
 * pending requests too. Also folds in attendance auto-leave days.
 */
router.get('/calendar', async (req, res, next) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : dayKey().slice(0, 7)
    const monthStart = startOfDay(`${month}-01`)
    const monthEnd = new Date(monthStart)
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)

    // Approved leaves overlapping the month (company-wide). Deliberately
    // excludes kind: 'wfh' — working from home isn't an absence, so it stays
    // off the "who's out" calendar entirely (this endpoint's whole purpose).
    const { rows: approved } = await q(
      `select l.*, u.name as employee_name
         from leaves l
         join users u on u.id = l.user_id
        where l.kind = 'leave' and l.status = 'approved'
          and l.start_date < $1 and l.end_date >= $2`,
      [monthEnd, monthStart],
    )

    // Build a per-day map: { 'YYYY-MM-DD': [{ name, type, self, ... }] }.
    // Every entry carries enough to render a full detail view on click
    // (dates, day count, status) — but `reason`/`decisionComment` are only
    // attached when the entry belongs to the viewer. The company-wide view is
    // deliberately "who + how many" only (requirements §4.5); a leave's reason
    // is personal justification meant for the employee and their manager
    // (§4.2), never for every coworker who happens to view the calendar.
    const byDay = {}
    const push = (key, entry) => {
      if (key.slice(0, 7) !== month) return
      ;(byDay[key] ??= []).push(entry)
    }
    for (const l of approved) {
      const isSelf = l.user_id === req.user.id
      const keys = dateKeysInRange(dayKey(l.start_date), dayKey(l.end_date))
      for (const k of keys) {
        push(k, {
          id: l.id,
          name: l.employee_name ?? 'Someone',
          type: l.type,
          self: isSelf,
          kind: 'leave',
          status: 'approved',
          startDate: dayKey(l.start_date),
          endDate: dayKey(l.end_date),
          days: l.days,
          createdAt: l.created_at,
          ...(isSelf ? { reason: l.reason, decisionComment: l.decision_comment || '' } : {}),
        })
      }
    }

    // The user's own pending/rejected leaves (so they show on their calendar).
    // Same kind: 'leave' exclusion as above — WFH requests live on the
    // Leaves page's own list, not this calendar.
    const { rows: own } = await q(
      `select * from leaves
        where kind = 'leave' and user_id = $1 and status in ('pending', 'rejected')
          and start_date < $2 and end_date >= $3`,
      [req.user.id, monthEnd, monthStart],
    )
    for (const l of own) {
      for (const k of dateKeysInRange(dayKey(l.start_date), dayKey(l.end_date))) {
        push(k, {
          id: l.id,
          name: 'You',
          type: l.type,
          self: true,
          kind: l.status,
          status: l.status,
          startDate: dayKey(l.start_date),
          endDate: dayKey(l.end_date),
          days: l.days,
          reason: l.reason,
          decisionComment: l.decision_comment || '',
          createdAt: l.created_at,
        })
      }
    }

    // Attendance auto-leave days for the current user (<8h days).
    await finalizeStaleSessions(req.user.id)
    const { rows: leaveDays } = await q(
      `select date from work_sessions
        where user_id = $1 and day_status = 'leave' and date between $2 and $3`,
      [req.user.id, `${month}-01`, `${month}-31`],
    )
    for (const s of leaveDays) {
      push(s.date, {
        id: `attendance-${s.date}`,
        name: 'You',
        type: 'attendance',
        self: true,
        kind: 'auto-leave',
        status: 'auto-leave',
        startDate: s.date,
        endDate: s.date,
        days: 1,
        reason: 'Automatically marked as leave — fewer than 8 hours were recorded that day.',
      })
    }

    res.json({ month, days: byDay })
  } catch (err) {
    next(err)
  }
})

export default router
