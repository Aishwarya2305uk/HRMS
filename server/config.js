/**
 * Single source of truth for HRMS business rules (per the v1 requirements doc).
 * Keep all "magic numbers" here so another developer can tune policy in one
 * place instead of hunting through routes.
 */

/**
 * Leave types and their fixed annual quota (days). Balances are seeded from
 * these when a user is created; deducted only when a manager approves a leave.
 * `key` is what the API/DB use; `label` is what the UI shows.
 */
export const LEAVE_TYPES = [
  { key: 'casual', label: 'Casual Leave', quota: 12 },
  { key: 'sick', label: 'Sick Leave', quota: 8 },
  { key: 'earned', label: 'Earned Leave', quota: 15 },
]

/** Fast lookups by key. */
export const LEAVE_TYPE_KEYS = LEAVE_TYPES.map((t) => t.key)
export const LEAVE_TYPE_BY_KEY = Object.fromEntries(LEAVE_TYPES.map((t) => [t.key, t]))

/** Total days granted per year across all types (used for the balance ring). */
export const TOTAL_ANNUAL_QUOTA = LEAVE_TYPES.reduce((sum, t) => sum + t.quota, 0)

/** A fresh balances object seeded from the quotas — e.g. { casual: 12, sick: 8, earned: 15 }. */
export function defaultLeaveBalances() {
  return Object.fromEntries(LEAVE_TYPES.map((t) => [t.key, t.quota]))
}

/**
 * A full working day. If the total recorded time for a day is below this, the
 * day auto-finalizes as "leave"; at or above, it's marked "present".
 */
export const FULL_WORKDAY_HOURS = 8
export const FULL_WORKDAY_SECONDS = FULL_WORKDAY_HOURS * 3600
