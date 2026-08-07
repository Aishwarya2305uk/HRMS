import { q } from './db.js'

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
 * bootstrapAdmin(). Only runs when the respective table is completely
 * empty, so it never resurrects something an admin deliberately removed.
 */
export async function bootstrapLeavePolicy() {
  const { rows: ltCount } = await q('select count(*)::int as n from leave_types')
  if (ltCount[0].n === 0) {
    // Two cold starts can both see "empty" and race to seed; the unique
    // `key` constraint plus on conflict do nothing lets the loser lose
    // quietly — the types exist either way.
    for (const t of DEFAULT_LEAVE_TYPES) {
      await q('insert into leave_types (key, label) values ($1, $2) on conflict (key) do nothing', [
        t.key,
        t.label,
      ])
    }
    console.log('[bootstrap] seeded default leave types (casual, sick, earned)')
  }

  const { rows: etCount } = await q('select count(*)::int as n from employment_types')
  if (etCount[0].n === 0) {
    for (const t of DEFAULT_EMPLOYMENT_TYPES) {
      await q('insert into employment_types (name, quotas) values ($1, $2)', [
        t.name,
        JSON.stringify(t.quotas),
      ])
    }
    console.log('[bootstrap] seeded default employment types (Full-time, Intern, Part-time)')
  }
}
