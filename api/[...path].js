/**
 * Vercel serverless entry point.
 *
 * On Vercel, any file under /api becomes a serverless function. Naming this
 * `[...path].js` makes it a catch-all, so every request to /api/* is handled
 * here and delegated to the shared Express app (server/app.js).
 *
 * Locally you don't use this file — run `npm run server` (or `dev:mem`), which
 * boots the same app via server/index.js. Both share createApp() + connectDB(),
 * so behavior is identical in dev and on Vercel.
 *
 * Required env vars on Vercel (Project → Settings → Environment Variables):
 *   MONGODB_URL, JWT_SECRET   (and optionally JWT_EXPIRES_IN, CRON_SECRET)
 */
import { connectDB } from '../server/db.js'
import { createApp } from '../server/app.js'

// Reused across warm invocations (connectDB caches the connection).
const app = createApp()

export default async function handler(req, res) {
  try {
    await connectDB()
  } catch (err) {
    console.error('[api] DB connection failed:', err.message)
    res.status(500).json({ error: 'Database connection failed.' })
    return
  }

  // The Express routes are mounted under /api/* (so the standalone server and
  // the Vite dev proxy both work). Depending on how the platform invokes this
  // catch-all, req.url may arrive WITHOUT the /api prefix (e.g. "/auth/login")
  // — which would make Express 404. Normalize so it always has exactly one
  // /api prefix, whichever way it comes in.
  const url = req.url || '/'
  if (!/^\/api(\/|\?|$)/.test(url)) {
    req.url = '/api' + (url.startsWith('/') ? url : `/${url}`)
  }

  return app(req, res)
}
