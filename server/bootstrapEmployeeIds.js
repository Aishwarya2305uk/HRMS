import { User } from './models/User.js'

/**
 * Backfills `employeeId` ("EMP001", ...) for users created before the field
 * existed. Runs on every connect (same spots as bootstrapAdmin: server/db.js
 * and dev-memory.js) but is a no-op once everyone has a code. Assigns in
 * createdAt order so the numbering matches hiring order; new users after
 * this get theirs from the pre-save hook in models/User.js.
 */
export async function bootstrapEmployeeIds() {
  const missing = await User.find({
    $or: [{ employeeId: null }, { employeeId: { $exists: false } }, { employeeId: '' }],
  }).sort({ createdAt: 1 })
  if (missing.length === 0) return

  // Sequentially — each save's pre-save hook reads the codes saved before it.
  for (const user of missing) await user.save()
  console.log(`[bootstrap] assigned employee IDs to ${missing.length} existing user(s)`)
}
