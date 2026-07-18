/**
 * Vercel serverless entry point.
 *
 * On Vercel, any file under /api becomes a serverless function. Naming this
 * `[...path].js` makes it a catch-all, so every request to /api/* is handled
 * here and delegated to the shared Express app (server/app.js). The request
 * keeps its original URL (e.g. /api/auth/login), which the app's routes match.
 *
 * Locally you don't use this file — run `npm run server` (or `dev:mem`), which
 * boots the same app via server/index.js. Both share createApp() + connectDB(),
 * so behavior is identical in dev and on Vercel.
 *
 * Required env vars on Vercel (Project → Settings → Environment Variables):
 *   MONGODB_URL, JWT_SECRET   (and optionally JWT_EXPIRES_IN)
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
  return app(req, res)
}
