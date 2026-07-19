import { Router } from 'express'
import { finalizeStaleSessions } from '../services/attendance.js'

const router = Router()

/**
 * GET /api/cron/finalize — end-of-day attendance finalizer, driven by Vercel
 * Cron (see vercel.json "crons"). Closes any still-open sessions from past
 * days and applies the 8-hour Present/Leave rule company-wide.
 *
 * Attendance is ALSO finalized lazily on read, so this cron is a belt-and-
 * suspenders backstop — the app is correct even without it.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. If CRON_SECRET
 * is set, we require it so the endpoint can't be triggered by the public.
 */
router.get('/finalize', async (req, res) => {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const header = req.headers.authorization || ''
    if (header !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized.' })
    }
  }
  try {
    const closed = await finalizeStaleSessions()
    res.json({ ok: true, closed })
  } catch (err) {
    console.error('[cron/finalize]', err)
    res.status(500).json({ error: 'Finalizer failed.' })
  }
})

export default router
