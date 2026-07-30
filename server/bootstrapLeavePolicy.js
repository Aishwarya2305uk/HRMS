import { LeaveType } from './models/LeaveType.js'
import { EmploymentType } from './models/EmploymentType.js'

/** The exact keys/labels/quotas this app shipped with before policies became
 *  admin-configurable — used only to seed a sensible starting point. */
const DEFAULT_LEAVE_TYPES = [
  { key: 'casual', label: 'Casual Leave' },
  { key: 'sick', label: 'Sick Leave' },
  { key: 'earned', label: 'Earned Leave' },
]

const DEFAULT_EMPLOYMENT_TYPES = [
  // Matches the app's original fixed quota exactly, so existing employees'
  // effective policy doesn't silently change the moment this ships.
  { name: 'Full-time', quotas: { casual: 12, sick: 8, earned: 15 } },
  { name: 'Intern', quotas: { casual: 5, sick: 3, earned: 0 } },
  { name: 'Part-time', quotas: { casual: 6, sick: 4, earned: 8 } },
]

/**
 * Seeds a starting set of leave types + employment types on first connect —
 * same "create once, then it's entirely admin-owned" policy as
 * bootstrapAdmin(). Only runs when the respective collection is completely
 * empty, so it never resurrects something an admin deliberately removed.
 *
 * Called from the same spots as bootstrapAdmin() (server/db.js and
 * server/dev-memory.js) so both the long-running server and the in-memory
 * dev path get a usable policy out of the box.
 */
export async function bootstrapLeavePolicy() {
  if ((await LeaveType.countDocuments()) === 0) {
    try {
      await LeaveType.insertMany(DEFAULT_LEAVE_TYPES, { ordered: false })
      console.log('[bootstrap] seeded default leave types (casual, sick, earned)')
    } catch (err) {
      // Two cold starts can both see "empty" and race to seed; the unique
      // `key` index rejects the loser's duplicates. Fine either way — the
      // types exist. Anything else should still surface.
      if (err?.code !== 11000) throw err
    }
  }

  if ((await EmploymentType.countDocuments()) === 0) {
    await EmploymentType.insertMany(DEFAULT_EMPLOYMENT_TYPES)
    console.log('[bootstrap] seeded default employment types (Full-time, Intern, Part-time)')
  }
}
