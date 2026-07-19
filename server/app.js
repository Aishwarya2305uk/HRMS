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

  // Unknown /api route -> JSON 404. The method/path are logged server-side for
  // debugging but NOT reflected back in the response: echoing raw request input
  // is needless attack surface, and the client can't act on it anyway.
  app.use('/api', (req, res) => {
    console.warn(`[api] 404 ${req.method} ${req.originalUrl}`)
    res.status(404).json({ error: 'That endpoint does not exist.' })
  })

  // Catch-all error handler. Full details go to the server log; the client only
  // ever gets a generic line, so DB/stack/internal messages can never leak
  // (OWASP: improper error handling / information disclosure).
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500
    console.error(`[api] ${req.method} ${req.originalUrl} ->`, err)
    // 4xx raised deliberately by our own routes carry user-safe copy; anything
    // else (including unexpected 500s) is replaced with a generic message.
    const safe =
      status < 500 && err.expose !== false && err.message
        ? err.message
        : 'Something went wrong. Please try again.'
    res.status(status).json({ error: safe })
  })

  return app
}
