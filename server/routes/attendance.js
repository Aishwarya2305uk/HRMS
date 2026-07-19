import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { WorkSession, computeWorkedSeconds, isRunning } from '../models/WorkSession.js'
import { finalizeStaleSessions, verdictFor } from '../services/attendance.js'
import { dayKey } from '../utils/time.js'

const router = Router()
router.use(requireAuth)

/**
 * Load (or create) today's session for the current user, after first closing
 * any stale open sessions from previous days. Returns the live session doc.
 */
async function getTodaySession(userId, { create = false } = {}) {
  await finalizeStaleSessions(userId)
  const date = dayKey()
  let session = await WorkSession.findOne({ userId, date })
  if (!session && create) {
    session = await WorkSession.create({ userId, date, events: [], status: 'active' })
  }
  return session
}

/** Append an event to today's session, enforcing valid state transitions. */
async function appendEvent(userId, type) {
  const session = await getTodaySession(userId, { create: type === 'check_in' })

  if (type === 'check_in') {
    if (session.events.some((e) => e.type === 'check_in')) {
      throw httpError(409, 'You have already checked in today.')
    }
  } else {
    if (!session || session.status !== 'active') {
      throw httpError(409, 'You need to check in first.')
    }
    const running = isRunning(session.events)
    if (type === 'pause' && !running) throw httpError(409, 'Timer is not running.')
    if (type === 'resume' && running) throw httpError(409, 'Timer is already running.')
  }

  session.events.push({ type, at: new Date() })

  // Manual check-out finalizes the day immediately (8h rule applies).
  if (type === 'check_out') {
    session.workedSeconds = computeWorkedSeconds(session.events, Date.now())
    session.dayStatus = verdictFor(session.workedSeconds)
    session.status = 'completed'
  }

  await session.save()
  return session
}

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/** GET /api/attendance/today — live status + elapsed seconds for today. */
router.get('/today', async (req, res, next) => {
  try {
    const session = await getTodaySession(req.user._id)
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
    res.json(session.toLiveJSON())
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
    const session = await appendEvent(req.user._id, type)
    res.json(session.toLiveJSON())
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
    await finalizeStaleSessions(req.user._id)
    const sessions = await WorkSession.find({ userId: req.user._id })
      .sort({ date: -1 })
      .limit(60)
    res.json(sessions.map((s) => s.toLiveJSON()))
  } catch (err) {
    next(err)
  }
})

export default router
