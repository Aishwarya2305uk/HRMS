import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { securityHeaders, corsPolicy } from './middleware/security.js'
import { requestLog } from './middleware/requestLog.js'
import authRoutes from './routes/auth.js'
import attendanceRoutes from './routes/attendance.js'
import leaveRoutes from './routes/leaves.js'
import employeeRoutes from './routes/employees.js'
import cronRoutes from './routes/cron.js'
import announcementRoutes from './routes/announcements.js'
import teamRoutes from './routes/teams.js'
import leaveTypeRoutes from './routes/leaveTypes.js'
import employmentTypeRoutes from './routes/employmentTypes.js'
import documentRoutes from './routes/documents.js'
import settingsRoutes from './routes/settings.js'
import systemLogRoutes from './routes/systemLogs.js'
import activityLogRoutes from './routes/activityLogs.js'

/** Builds the Express app (routes only — no DB connection, no listen). */
export function createApp() {
  const app = express()
  // One proxy hop in front of us (the Vercel rewrite / Render's edge) — makes
  // req.ip the real client address, which the login rate limiter keys on.
  app.set('trust proxy', 1)
  app.use(securityHeaders)
  app.use(corsPolicy)
  // Limit raised from Express's 100kb default to fit the largest inline
  // upload: employee documents (routes/documents.js caps them at ~3MB
  // decoded, ~4.2MB as a base64 data URL); profile photos are far smaller.
  app.use(express.json({ limit: '6mb' }))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  // Record every API call for the admin System Logs page. Mounted after the
  // health ping (uptime monitors would flood the table) and before every real
  // route, so nothing else escapes it.
  app.use('/api', requestLog)
  app.use('/api/auth', authRoutes)
  app.use('/api/attendance', attendanceRoutes)
  app.use('/api/leaves', leaveRoutes)
  app.use('/api/employees', employeeRoutes)
  app.use('/api/cron', cronRoutes)
  app.use('/api/announcements', announcementRoutes)
  app.use('/api/teams', teamRoutes)
  app.use('/api/leave-types', leaveTypeRoutes)
  app.use('/api/employment-types', employmentTypeRoutes)
  app.use('/api/documents', documentRoutes)
  app.use('/api/settings', settingsRoutes)
  app.use('/api/system-logs', systemLogRoutes)
  app.use('/api/activity-logs', activityLogRoutes)

  // Unknown /api route -> JSON 404. The method/path are logged server-side for
  // debugging but NOT reflected back in the response: echoing raw request input
  // is needless attack surface, and the client can't act on it anyway.
  app.use('/api', (req, res) => {
    console.warn(`[api] 404 ${req.method} ${req.originalUrl}`)
    res.status(404).json({ error: 'That endpoint does not exist.' })
  })

  // Single-app deployments (e.g. a Hostinger Node.js Web App) serve the built
  // frontend from this same process: dist/ exists there because the platform
  // runs `npm run build` before starting the server. In dev there is no dist/
  // — the Vite dev server owns the frontend — so this block is skipped.
  const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')
  if (existsSync(distDir)) {
    app.use(express.static(distDir))
    // SPA fallback: any non-API GET (e.g. /dashboard) loads index.html and
    // React Router takes it from there. `/{*splat}` is Express 5 wildcard
    // syntax — the bare `*` of Express 4 no longer parses.
    app.get('/{*splat}', (_req, res) => res.sendFile(resolve(distDir, 'index.html')))
  }

  // Catch-all error handler. Full details go to the server log; the client only
  // ever gets a generic line, so DB/stack/internal messages can never leak
  // (OWASP: improper error handling / information disclosure).
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500
    console.error(`[api] ${req.method} ${req.originalUrl} ->`, err)
    // The admin System Logs row gets the real reason (its audience is admins
    // only); the HTTP response below still never carries internals.
    res.locals.logDetail = err?.message

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
