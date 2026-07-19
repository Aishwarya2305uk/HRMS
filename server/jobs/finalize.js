/**
 * End-of-day finalizer as a standalone runner. On serverless the same logic
 * runs lazily on read (see services/attendance.js), so this is only needed for
 * deployments with a real scheduler.
 *
 *   node server/jobs/finalize.js        # one-off
 *   # or wire into cron just after midnight UTC
 */
import mongoose from 'mongoose'
import { pathToFileURL } from 'node:url'
import { connectDB } from '../db.js'
import { finalizeStaleSessions } from '../services/attendance.js'

export async function runFinalizer() {
  const closed = await finalizeStaleSessions()
  console.log(`[finalize] auto-closed ${closed} stale session(s)`)
  return closed
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  connectDB()
    .then(runFinalizer)
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[finalize] failed:', err.message)
      process.exit(1)
    })
}
