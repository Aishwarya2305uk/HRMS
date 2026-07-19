/**
 * Runs the full backend against an in-memory MongoDB — no Atlas password
 * needed. Great for local dev / demos before the real MONGODB_URL is set.
 *
 * Run with:  npm run dev:mem   (starts this API; run `npm run dev` for the UI)
 * Or both:   npm run dev:all:mem
 *
 * NOTE: data lives only in memory and is wiped when the process exits.
 */
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { seedDemoUsers } from './seed.js'
import { createApp } from './app.js'

// The Vite dev proxy targets port 4000 (see vite.config.js), so the in-memory
// API binds there by default. We read API_PORT (not PORT) so that a PORT env
// injected for the web server — e.g. by tooling that sets PORT=5173 — never
// accidentally steals the API onto the web port and breaks the proxy.
const PORT = Number(process.env.API_PORT) || 4000

async function start() {
  const mem = await MongoMemoryServer.create()
  await mongoose.connect(mem.getUri(), { dbName: 'hrms' })
  console.log('[dev:mem] in-memory MongoDB ready (data is not persisted)')

  await seedDemoUsers()

  createApp().listen(PORT, () => {
    console.log(`[dev:mem] API listening on http://localhost:${PORT}`)
  })

  const shutdown = async () => {
    await mongoose.disconnect()
    await mem.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start().catch((err) => {
  console.error('[dev:mem] failed:', err.message)
  process.exit(1)
})
