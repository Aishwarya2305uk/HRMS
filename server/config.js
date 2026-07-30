/**
 * Single source of truth for HRMS business rules that aren't admin-managed
 * data. (Leave types and their quotas used to live here as fixed constants —
 * they're now admin-configurable records; see models/LeaveType.js and
 * models/EmploymentType.js.)
 */

/**
 * A full working day. If the total recorded time for a day is below this, the
 * day auto-finalizes as "leave"; at or above, it's marked "present".
 */
export const FULL_WORKDAY_HOURS = 8
export const FULL_WORKDAY_SECONDS = FULL_WORKDAY_HOURS * 3600
