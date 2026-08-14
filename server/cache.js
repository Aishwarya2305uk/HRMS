import { q } from './db.js'

/**
 * Tiny TTL'd read-through cache for hot REFERENCE data only (leave types,
 * employment types, app settings). Supabase is always the source of truth:
 * every mutating route calls invalidate() for its key, and because ONE
 * long-running server owns this cache, the very next read — from any user —
 * refetches fresh data. The TTL is just a belt-and-braces bound in case a
 * future write path forgets to invalidate.
 *
 * Deliberately NEVER used for per-user rows, authorization data, or
 * write-path validation reads — those always go to Postgres.
 */
const TTL_MS = 30_000
const store = new Map()

export async function cached(key, load) {
  const hit = store.get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  const value = await load()
  store.set(key, { value, expires: Date.now() + TTL_MS })
  return value
}

export function invalidate(...keys) {
  for (const key of keys) store.delete(key)
}

/** All leave_types rows (active and retired), in creation order. */
export const cachedLeaveTypes = () =>
  cached('leave_types', () => q('select * from leave_types order by created_at').then((r) => r.rows))

/** All employment_types rows, in creation order. */
export const cachedEmploymentTypes = () =>
  cached('employment_types', () =>
    q('select * from employment_types order by created_at').then((r) => r.rows),
  )

/** The app_settings singleton row (upsert-on-read: first access creates it). */
export const cachedAppSettings = () =>
  cached('app_settings', () =>
    q(
      `insert into app_settings (id) values (1)
       on conflict (id) do update set id = 1
       returning *`,
    ).then((r) => r.rows[0]),
  )
