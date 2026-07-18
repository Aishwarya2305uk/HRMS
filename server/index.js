import { PORT } from './env.js'
import { connectDB } from './db.js'
import { createApp } from './app.js'

async function start() {
  try {
    await connectDB()
    const app = createApp()
    app.listen(PORT, () => {
      console.log(`[server] API listening on http://localhost:${PORT}`)
    })
  } catch (err) {
    console.error('[server] failed to start:', err.message)
    process.exit(1)
  }
}

start()
