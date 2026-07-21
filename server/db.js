import dns from 'node:dns'
import mongoose from 'mongoose'
import { MONGODB_URL } from './env.js'
import { bootstrapAdmin } from './bootstrapAdmin.js'

// Some routers/VPNs proxy DNS in a way that answers plain lookups (nslookup)
// but refuses the raw SRV query Node's resolver sends for mongodb+srv://
// URLs, failing with "querySrv ECONNREFUSED". Pointing Node at public
// resolvers sidesteps that without touching OS network settings.
dns.setServers(['8.8.8.8', '1.1.1.1'])

/**
 * Cached connection — critical for serverless (e.g. Vercel functions), where
 * each invocation may reuse a warm container. Without caching, every cold
 * start opens a new connection and quickly exhausts the Atlas pool.
 * The cache lives on globalThis so it survives module re-evaluation.
 */
const globalCache = globalThis
globalCache._mongoose ??= { conn: null, promise: null }
const cache = globalCache._mongoose

export async function connectDB() {
  if (cache.conn) return cache.conn

  if (!MONGODB_URL) {
    throw new Error(
      'MONGODB_URL is not set. Add it to .env.local (replace <db_password> with your Atlas password).',
    )
  }
  if (MONGODB_URL.includes('<db_password>')) {
    throw new Error(
      'MONGODB_URL still contains the "<db_password>" placeholder. Replace it with your real Atlas password in .env.local.',
    )
  }

  if (!cache.promise) {
    mongoose.set('strictQuery', true)
    cache.promise = mongoose
      .connect(MONGODB_URL, {
        dbName: 'hrms',
        serverSelectionTimeoutMS: 8000,
        // Keep the pool small — serverless spawns many isolated instances.
        maxPoolSize: 5,
      })
      .then(async (m) => {
        console.log('[db] connected to MongoDB (database: hrms)')
        // Runs exactly once per connection (this .then() only fires on the
        // first successful connect — later calls reuse cache.conn), so this
        // is safe for both the long-running server and serverless cold starts.
        await bootstrapAdmin()
        return m
      })
  }

  try {
    cache.conn = await cache.promise
  } catch (err) {
    cache.promise = null // allow retry on next invocation
    throw err
  }
  return cache.conn
}
