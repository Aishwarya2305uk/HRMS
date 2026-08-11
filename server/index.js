import { PORT } from './env.js'
import { connectDB } from './db.js'
import { createApp } from './app.js'

// Transient outbound blips — Wi-Fi still re-establishing after a laptop wake,
// a cold Supabase pooler, an ISP hiccup — shouldn't kill the process on its
// first connection attempt. Retry briefly, then give up loudly: persistent
// failure still means something real (paused project, firewall, no network).
const MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 4000
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function start() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await connectDB()
      break
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        console.error(`[server] failed to start after ${MAX_ATTEMPTS} attempts:`, err.message)
        process.exit(1)
      }
      console.warn(
        `[server] database connection failed (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${RETRY_DELAY_MS / 1000}s: ${err.message}`,
      )
      await delay(RETRY_DELAY_MS)
    }
  }
  const app = createApp()
  app.listen(PORT, () => {
    console.log(`[server] API listening on http://localhost:${PORT}`)
  })
}

start()
