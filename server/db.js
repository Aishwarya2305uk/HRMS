import pg from 'pg'
import { DATABASE_URL } from './env.js'
import { ensureSchema } from './schema.js'
import { bootstrapAdmin } from './bootstrapAdmin.js'
import { bootstrapLeavePolicy } from './bootstrapLeavePolicy.js'
import { bootstrapEmployeeIds } from './bootstrapEmployeeIds.js'

const { Pool, types } = pg

// numeric (e.g. leaves.days) comes back as a string by default — the API
// serves it as a number (0.5, 2, ...).
types.setTypeParser(1700, (v) => Number(v))
// date columns (if any are ever added) as plain 'YYYY-MM-DD' strings, not
// local-midnight Date objects that shift across timezones.
types.setTypeParser(1082, (v) => v)

/**
 * Cached pool — critical for serverless (e.g. Vercel functions), where each
 * invocation may reuse a warm container. Without caching, every cold start
 * opens new connections and quickly exhausts the pooler. The cache lives on
 * globalThis so it survives module re-evaluation.
 */
const globalCache = globalThis
globalCache._pgpool ??= { pool: null, bootstrapped: null }
const cache = globalCache._pgpool

export function getPool() {
  if (cache.pool) return cache.pool
  if (!DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Add your Supabase connection string to .env.local (see .env.example).',
    )
  }
  cache.pool = new Pool({
    connectionString: DATABASE_URL,
    // Keep the pool small — serverless spawns many isolated instances.
    max: 5,
    // Supabase's pooler presents a certificate chain outside Node's default
    // CA store; TLS is still used, we just skip chain verification.
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  })
  return cache.pool
}

/** Run one query against the shared pool. */
export function q(text, params) {
  return getPool().query(text, params)
}

/**
 * Run `fn(client)` inside a BEGIN/COMMIT transaction, rolling back on any
 * throw. Used wherever multiple writes must land together (e.g. leave
 * approval's deduct-then-flip).
 */
export async function tx(fn) {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}

export async function connectDB() {
  const pool = getPool()
  if (!cache.bootstrapped) {
    // Runs exactly once per process (later calls await the same promise), so
    // this is safe for both the long-running server and serverless cold
    // starts. Schema first (a fresh database gets its tables created), then
    // leave policy before bootstrapAdmin: the admin is assigned a default
    // employment type, so that type must already exist.
    cache.bootstrapped = (async () => {
      await pool.query('select 1') // fail fast if the DB is unreachable
      console.log('[db] connected to Supabase Postgres')
      await ensureSchema(pool)
      await bootstrapLeavePolicy()
      await bootstrapAdmin()
      await bootstrapEmployeeIds()
    })().catch((err) => {
      cache.bootstrapped = null // allow retry on next invocation
      throw err
    })
  }
  await cache.bootstrapped
  return pool
}

/** Close the pool — for one-off scripts (seed, finalize) so they can exit. */
export async function closeDB() {
  if (cache.pool) {
    await cache.pool.end()
    cache.pool = null
    cache.bootstrapped = null
  }
}
