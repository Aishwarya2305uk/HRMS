import { Router } from 'express'
import mongoose from 'mongoose'
import { requireAuth } from '../middleware/auth.js'
import { User } from '../models/User.js'
import { Leave } from '../models/Leave.js'
import { WorkSession } from '../models/WorkSession.js'
import { LEAVE_TYPE_BY_KEY, LEAVE_TYPE_KEYS } from '../config.js'
import { finalizeStaleSessions } from '../services/attendance.js'
import { dayKey, inclusiveDays, startOfDay, dateKeysInRange } from '../utils/time.js'

const router = Router()
router.use(requireAuth)

/** GET /api/leaves/config — leave types + quotas (so the UI stays in sync). */
router.get('/config', (_req, res) => {
  res.json({ types: Object.values(LEAVE_TYPE_BY_KEY) })
})

/**
 * POST /api/leaves — apply for leave.
 * Body: { type, startDate, endDate, reason }
 * Validates the range and that the current balance covers the request.
 */
router.post('/', async (req, res, next) => {
  try {
    const { type, startDate, endDate, reason = '' } = req.body || {}
    if (!LEAVE_TYPE_KEYS.includes(type)) {
      return res.status(400).json({ error: 'Please choose a valid leave type.' })
    }
    const startKey = String(startDate || '').slice(0, 10)
    const endKey = String(endDate || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startKey) || !/^\d{4}-\d{2}-\d{2}$/.test(endKey)) {
      return res.status(400).json({ error: 'Start and end dates are required.' })
    }
    if (endKey < startKey) {
      return res.status(400).json({ error: 'End date cannot be before the start date.' })
    }

    const days = inclusiveDays(startKey, endKey)
    req.user.ensureLeaveBalances()
    const remaining = Number(req.user.leaveBalances[type]) || 0
    if (days > remaining) {
      const label = LEAVE_TYPE_BY_KEY[type].label
      return res.status(400).json({
        error: `Insufficient ${label} balance — you have ${remaining} day(s) left but requested ${days}.`,
      })
    }

    const leave = await Leave.create({
      userId: req.user._id,
      type,
      startDate: startOfDay(startKey),
      endDate: startOfDay(endKey),
      days,
      reason: String(reason).trim(),
      status: 'pending',
    })
    res.status(201).json(leave.toJSONSafe())
  } catch (err) {
    next(err)
  }
})

/** GET /api/leaves/mine — the current user's own applications (newest first). */
router.get('/mine', async (req, res, next) => {
  try {
    const leaves = await Leave.find({ userId: req.user._id }).sort({ createdAt: -1 })
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
      .populate('userId', 'name')
      .sort({ createdAt: 1 })
    res.json(leaves.map((l) => l.toJSONSafe()))
  } catch (err) {
    next(err)
  }
})

/** Shared guard: the acting user must be the leave owner's direct manager. */
async function loadDecidableLeave(req) {
  const leave = await Leave.findById(req.params.id).populate('userId', 'name managerId')
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

/** POST /api/leaves/:id/approve — approve + deduct balance from the employee. */
router.post('/:id/approve', async (req, res, next) => {
  try {
    const leave = await loadDecidableLeave(req)
    const employee = await User.findById(leave.userId._id)
    employee.ensureLeaveBalances()
    const remaining = Number(employee.leaveBalances[leave.type]) || 0
    if (leave.days > remaining) {
      return res.status(400).json({
        error: `Cannot approve — employee only has ${remaining} day(s) of that leave left.`,
      })
    }
    employee.leaveBalances[leave.type] = remaining - leave.days
    employee.markModified('leaveBalances')
    await employee.save()

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
      .populate('userId', 'name')
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

    // Approved leaves overlapping the month (company-wide).
    const approved = await Leave.find({
      status: 'approved',
      startDate: { $lt: monthEnd },
      endDate: { $gte: monthStart },
    }).populate('userId', 'name')

    // Build a per-day map: { 'YYYY-MM-DD': [{ name, type, self }] }.
    const byDay = {}
    const push = (key, entry) => {
      if (key.slice(0, 7) !== month) return
      ;(byDay[key] ??= []).push(entry)
    }
    for (const l of approved) {
      const keys = dateKeysInRange(dayKey(l.startDate), dayKey(l.endDate))
      for (const k of keys) {
        push(k, {
          name: l.userId?.name ?? 'Someone',
          type: l.type,
          self: l.userId?._id?.toString() === req.user._id.toString(),
          kind: 'leave',
        })
      }
    }

    // The user's own pending/rejected leaves (so they show on their calendar).
    const own = await Leave.find({
      userId: req.user._id,
      status: { $in: ['pending', 'rejected'] },
      startDate: { $lt: monthEnd },
      endDate: { $gte: monthStart },
    })
    for (const l of own) {
      for (const k of dateKeysInRange(dayKey(l.startDate), dayKey(l.endDate))) {
        push(k, { name: 'You', type: l.type, self: true, kind: l.status })
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
      push(s.date, { name: 'You', type: 'attendance', self: true, kind: 'auto-leave' })
    }

    res.json({ month, days: byDay })
  } catch (err) {
    next(err)
  }
})

export default router
