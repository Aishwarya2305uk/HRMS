import { Router } from 'express'
import mongoose from 'mongoose'
import { requireAuth } from '../middleware/auth.js'
import { User } from '../models/User.js'
import { Leave } from '../models/Leave.js'
import { LeaveType } from '../models/LeaveType.js'
import { WorkSession } from '../models/WorkSession.js'
import { finalizeStaleSessions } from '../services/attendance.js'
import { dayKey, inclusiveDays, startOfDay, dateKeysInRange } from '../utils/time.js'

const router = Router()
router.use(requireAuth)

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

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
 * totalDays } — one request doc is created per contiguous run so the
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

/** GET /api/leaves/config — active leave types (so the UI stays in sync with
 *  whatever admin currently has configured — see routes/leaveTypes.js). */
router.get('/config', async (_req, res, next) => {
  try {
    const types = await LeaveType.find({ active: true }).sort({ createdAt: 1 })
    res.json({ types: types.map((t) => t.toJSONSafe()) })
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
    const leaveType = type ? await LeaveType.findOne({ key: type, active: true }) : null
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

    await req.user.ensureLeaveBalances()
    const remaining = Number(req.user.leaveBalances[type]) || 0
    if (totalDays > remaining) {
      return res.status(400).json({
        error: `Insufficient ${leaveType.label} balance — you have ${remaining} day(s) left but requested ${totalDays}.`,
      })
    }

    const ranges = custom
      ? when.ranges
      : [{ start: when.startKey, end: when.endKey }]
    const created = []
    for (const r of ranges) {
      const leave = await Leave.create({
        userId: req.user._id,
        type,
        startDate: startOfDay(r.start),
        endDate: startOfDay(r.end),
        dayPart: when.dayPart,
        startTime: when.startTime,
        endTime: when.endTime,
        days: when.dayPart === 'full' ? inclusiveDays(r.start, r.end) : 0.5,
        reason: String(reason).trim(),
        status: 'pending',
      })
      leave.userId = req.user // so the response carries name/email/employeeId
      created.push(leave.toJSONSafe())
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

    const ranges = custom
      ? when.ranges
      : [{ start: when.startKey, end: when.endKey }]
    const created = []
    for (const r of ranges) {
      const wfh = await Leave.create({
        userId: req.user._id,
        kind: 'wfh',
        startDate: startOfDay(r.start),
        endDate: startOfDay(r.end),
        dayPart: when.dayPart,
        startTime: when.startTime,
        endTime: when.endTime,
        days: when.dayPart === 'full' ? inclusiveDays(r.start, r.end) : 0.5,
        reason: trimmedReason,
        status: 'pending',
      })
      wfh.userId = req.user // so the response carries name/email/employeeId
      created.push(wfh.toJSONSafe())
    }
    res.status(201).json(custom ? created : created[0])
  } catch (err) {
    next(err)
  }
})

/** GET /api/leaves/mine — the current user's own applications (newest first). */
router.get('/mine', async (req, res, next) => {
  try {
    const leaves = await Leave.find({ userId: req.user._id })
      .populate('userId', 'name email employeeId')
      .sort({ createdAt: -1 })
    res.json(leaves.map((l) => l.toJSONSafe()))
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/leaves/:id — cancel one of the CURRENT USER's own PENDING
 * leave requests. Balance is never touched: it's only deducted on approval
 * (see /:id/approve below), so a pending request cancels for free.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid leave id.' })
    }
    const leave = await Leave.findById(req.params.id)
    if (!leave) return res.status(404).json({ error: 'Leave request not found.' })
    if (leave.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'You can only cancel your own leave requests.' })
    }
    if (leave.status !== 'pending') {
      return res.status(409).json({ error: 'Only pending leave requests can be cancelled.' })
    }
    await leave.deleteOne()
    res.json({ id: req.params.id })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/leaves/pending — a manager's approval queue: PENDING leaves from
 * their DIRECT REPORTS only. Backend-enforced so no one can peek at others'.
 */
router.get('/pending', async (req, res, next) => {
  try {
    if (!['manager', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only managers can view approvals.' })
    }
    const reports = await User.find({ managerId: req.user._id }).select('_id')
    const ids = reports.map((r) => r._id)
    const leaves = await Leave.find({ userId: { $in: ids }, status: 'pending' })
      .populate('userId', 'name email employeeId')
      .sort({ createdAt: 1 })
    res.json(leaves.map((l) => l.toJSONSafe()))
  } catch (err) {
    next(err)
  }
})

/** Shared guard: the acting user must be the leave owner's direct manager. */
async function loadDecidableLeave(req) {
  const leave = await Leave.findById(req.params.id).populate('userId', 'name email employeeId managerId')
  if (!leave) throw Object.assign(new Error('Leave not found.'), { status: 404 })
  if (leave.status !== 'pending') {
    throw Object.assign(new Error('This leave has already been decided.'), { status: 409 })
  }
  const ownerManagerId = leave.userId?.managerId?.toString()
  const isDirectManager = ownerManagerId && ownerManagerId === req.user._id.toString()
  if (!isDirectManager) {
    throw Object.assign(
      new Error('You can only act on leaves of your direct reports.'),
      { status: 403 },
    )
  }
  return leave
}

/**
 * POST /api/leaves/:id/approve — approve. For kind: 'leave' this also deducts
 * the balance; kind: 'wfh' skips that entirely (a location change, not time
 * off — there's no balance to deduct from).
 */
router.post('/:id/approve', async (req, res, next) => {
  try {
    const leave = await loadDecidableLeave(req)

    if (leave.kind === 'leave') {
      const employee = await User.findById(leave.userId._id)
      await employee.ensureLeaveBalances()
      const remaining = Number(employee.leaveBalances[leave.type]) || 0
      if (leave.days > remaining) {
        return res.status(400).json({
          error: `Cannot approve — employee only has ${remaining} day(s) of that leave left.`,
        })
      }
      employee.leaveBalances[leave.type] = remaining - leave.days
      employee.markModified('leaveBalances')
      await employee.save()
    }

    leave.status = 'approved'
    leave.approverId = req.user._id
    leave.decidedAt = new Date()
    await leave.save()
    res.json(leave.toJSONSafe())
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

/** POST /api/leaves/:id/reject — reject (no balance change). Optional comment. */
router.post('/:id/reject', async (req, res, next) => {
  try {
    const leave = await loadDecidableLeave(req)
    leave.status = 'rejected'
    leave.approverId = req.user._id
    leave.decidedAt = new Date()
    leave.decisionComment = String(req.body?.comment || '').trim()
    await leave.save()
    res.json(leave.toJSONSafe())
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
    const leaves = await Leave.find({})
      .populate('userId', 'name email employeeId')
      .sort({ createdAt: -1 })
    res.json(leaves.map((l) => l.toJSONSafe()))
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
    const month = /^\d{4}-\d{2}$/.test(req.body?.month || req.query.month || '')
      ? req.query.month
      : dayKey().slice(0, 7)
    const monthStart = startOfDay(`${month}-01`)
    const monthEnd = new Date(monthStart)
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)

    // Approved leaves overlapping the month (company-wide). Deliberately
    // excludes kind: 'wfh' — working from home isn't an absence, so it stays
    // off the "who's out" calendar entirely (this endpoint's whole purpose).
    const approved = await Leave.find({
      kind: 'leave',
      status: 'approved',
      startDate: { $lt: monthEnd },
      endDate: { $gte: monthStart },
    }).populate('userId', 'name')

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
      const isSelf = l.userId?._id?.toString() === req.user._id.toString()
      const keys = dateKeysInRange(dayKey(l.startDate), dayKey(l.endDate))
      for (const k of keys) {
        push(k, {
          id: l._id.toString(),
          name: l.userId?.name ?? 'Someone',
          type: l.type,
          self: isSelf,
          kind: 'leave',
          status: 'approved',
          startDate: dayKey(l.startDate),
          endDate: dayKey(l.endDate),
          days: l.days,
          createdAt: l.createdAt,
          ...(isSelf ? { reason: l.reason, decisionComment: l.decisionComment || '' } : {}),
        })
      }
    }

    // The user's own pending/rejected leaves (so they show on their calendar).
    // Same kind: 'leave' exclusion as above — WFH requests live on the
    // Leaves page's own list, not this calendar.
    const own = await Leave.find({
      kind: 'leave',
      userId: req.user._id,
      status: { $in: ['pending', 'rejected'] },
      startDate: { $lt: monthEnd },
      endDate: { $gte: monthStart },
    })
    for (const l of own) {
      for (const k of dateKeysInRange(dayKey(l.startDate), dayKey(l.endDate))) {
        push(k, {
          id: l._id.toString(),
          name: 'You',
          type: l.type,
          self: true,
          kind: l.status,
          status: l.status,
          startDate: dayKey(l.startDate),
          endDate: dayKey(l.endDate),
          days: l.days,
          reason: l.reason,
          decisionComment: l.decisionComment || '',
          createdAt: l.createdAt,
        })
      }
    }

    // Attendance auto-leave days for the current user (<8h days).
    await finalizeStaleSessions(req.user._id)
    const leaveDays = await WorkSession.find({
      userId: req.user._id,
      dayStatus: 'leave',
      date: { $gte: `${month}-01`, $lte: `${month}-31` },
    }).select('date')
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
