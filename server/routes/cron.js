import { Router } from 'express'
import { finalizeStaleSessions } from '../services/attendance.js'

const router = Router()

/**
 * GET /api/cron/finalize — end-of-day attendance finalizer, for any external
 * scheduler (GitHub Actions, cron-job.org, a paid Render cron — see
 * render.yaml). Closes any still-open sessions from past days and applies
 * the 8-hour Present/Leave rule company-wide.
 *
 * Attendance is ALSO finalized lazily on read, so this cron is a belt-and-
 * suspenders backstop — the app is correct even without it.
 *
 * Auth: the caller sends `Authorization: Bearer $CRON_SECRET`. FAILS CLOSED:
 * if CRON_SECRET isn't configured the endpoint refuses to run at all —
 * a missing env var must never silently turn this into a public endpoint.
 * (Safe default: attendance is also finalized lazily on read, so nothing
 * breaks while the secret is unset.)
 */
router.get('/finalize', async (req, res) => {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    console.error('[cron/finalize] CRON_SECRET is not configured — refusing to run.')
    return res.status(503).json({ error: 'Cron endpoint is not configured.' })
  }
  const header = req.headers.authorization || ''
  if (header !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized.' })
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
