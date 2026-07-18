import express from 'express'
import cors from 'cors'
import authRoutes from './routes/auth.js'

/** Builds the Express app (routes only — no DB connection, no listen). */
export function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRoutes)

  return app
}
