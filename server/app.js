import express from 'express'
import cors from 'cors'
import authRoutes from './routes/auth.js'
import attendanceRoutes from './routes/attendance.js'
import leaveRoutes from './routes/leaves.js'
import employeeRoutes from './routes/employees.js'
import cronRoutes from './routes/cron.js'

/**
 * JSON body parsing that works BOTH as a standalone server and inside a Vercel
 * serverless function.
 *
 * On Vercel, the Node runtime already parses the request body and populates
 * req.body (consuming the underlying stream). If we then ran express.json() it
 * would read an empty, already-consumed stream and clobber req.body with {} —
 * making every POST look like it has no data. So: only run express.json() when
 * the body hasn't been parsed yet (i.e. the classic long-running server path).
 */
function smartJson() {
  const parser = express.json()
  return (req, res, next) => {
    if (req.body !== undefined && req.body !== null) return next()
    parser(req, res, next)
  }
}

/** Builds the Express app (routes only — no DB connection, no listen). */
export function createApp() {
  const app = express()
  app.use(cors())
  app.use(smartJson())

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRoutes)
  app.use('/api/attendance', attendanceRoutes)
  app.use('/api/leaves', leaveRoutes)
  app.use('/api/employees', employeeRoutes)
  app.use('/api/cron', cronRoutes)

  // Catch-all error handler so route bugs return JSON, not an HTML stack trace.
  app.use((err, _req, res, _next) => {
    console.error('[api] unhandled error:', err)
    res.status(err.status || 500).json({ error: err.message || 'Something went wrong.' })
  })

  return app
}
