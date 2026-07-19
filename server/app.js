import express from 'express'
import cors from 'cors'
import authRoutes from './routes/auth.js'
import attendanceRoutes from './routes/attendance.js'
import leaveRoutes from './routes/leaves.js'
import employeeRoutes from './routes/employees.js'

/** Builds the Express app (routes only — no DB connection, no listen). */
export function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRoutes)
  app.use('/api/attendance', attendanceRoutes)
  app.use('/api/leaves', leaveRoutes)
  app.use('/api/employees', employeeRoutes)

  // Catch-all error handler so route bugs return JSON, not an HTML stack trace.
  app.use((err, _req, res, _next) => {
    console.error('[api] unhandled error:', err)
    res.status(err.status || 500).json({ error: err.message || 'Something went wrong.' })
  })

  return app
}
