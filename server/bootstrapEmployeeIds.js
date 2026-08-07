import { q } from './db.js'
import { nextEmployeeId } from './store.js'

/**
 * Backfills `employee_id` ("EMP001", ...) for users created before the field
 * existed. Runs on every connect (from connectDB) but is a no-op once
 * everyone has a code. Assigns in created_at order so the numbering matches
 * hiring order; new users get theirs at insert time.
 */
export async function bootstrapEmployeeIds() {
  const { rows: missing } = await q(
    "select id from users where employee_id is null or employee_id = '' order by created_at",
  )
  if (missing.length === 0) return

  // Sequentially — each assignment must see the codes assigned before it.
  for (const row of missing) {
    await q('update users set employee_id = $1 where id = $2', [await nextEmployeeId(), row.id])
  }
  console.log(`[bootstrap] assigned employee IDs to ${missing.length} existing user(s)`)
}
