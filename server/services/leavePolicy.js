/**
 * Hours-based leave policy engine.
 *
 * Everything is stored in DAYS with 8 hours = 1 day (FULL_WORKDAY_HOURS), so
 * a 2-hour request is days = 0.25 — but all math starts from hours: a leave
 * type's policy reads "<x> days|hours per day|month|year" (unit and period
 * live on leave_types; the amount per employment type in
 * employment_types.quotas, always day-denominated).
 *
 * Two balance models, chosen by the type's period:
 *  - 'year'  — the existing stored counter (users.leave_balances), seeded at
 *    hire and deducted on approval / refunded on cancellation.
 *  - 'day' / 'month' — the allowance refreshes each period, so nothing is
 *    stored: remaining = quota − sum(approved requests starting in the
 *    period), computed on read. Approval re-checks inside its transaction
 *    (after the user row is locked) instead of decrementing anything.
 *
 * A multi-day request counts wholly toward the period its START date falls
 * in — a deliberate v1 simplification, noted where it matters.
 */
import { q } from '../db.js'
import { FULL_WORKDAY_HOURS } from '../config.js'
import { cachedLeaveTypes, cachedEmploymentTypes } from '../cache.js'
import { ensureLeaveBalances } from '../store.js'
import { dayKey, startOfDay } from '../utils/time.js'

export const DAY_HOURS = FULL_WORKDAY_HOURS

/** Guard against float drift when summing day fractions (0.125 steps). */
const round4 = (n) => Math.round(Number(n) * 10000) / 10000

/** Minutes of a 'HH:MM'–'HH:MM' window (0 when either side is missing). */
export function windowMinutes(startTime, endTime) {
  if (!/^\d{2}:\d{2}$/.test(startTime || '') || !/^\d{2}:\d{2}$/.test(endTime || '')) return 0
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  return eh * 60 + em - (sh * 60 + sm)
}

/**
 * Day fraction one date of a request consumes. Presets stay fixed (full = 1,
 * half = 0.5); a custom window converts its hours at 8h = 1 day, capped at
 * one full day — "8 hours is considered 1 day of leave".
 */
export function perDayFraction(dayPart, startTime, endTime) {
  if (dayPart === 'full') return 1
  if (dayPart === 'first' || dayPart === 'second') return 0.5
  const minutes = Math.min(windowMinutes(startTime, endTime), DAY_HOURS * 60)
  return round4(minutes / (DAY_HOURS * 60))
}

/**
 * The approved FULL-day leave (kind 'leave') covering `dateKey` for a user,
 * or null. "Full day" = the request takes the whole of each date (Full day,
 * or a custom window of 8h+); a half day or a shorter window leaves part of
 * the day to work, so it doesn't count. What routes/attendance.js uses to
 * keep someone from checking in on a day they're on leave — and to tell the
 * dashboard why the buttons are greyed out. Never WFH: working from home is
 * still working.
 * @returns {Promise<{id:string,type:string,label:string,startDate:string,endDate:string}|null>}
 */
export async function approvedFullDayLeaveOn(userId, dateKey) {
  const day = startOfDay(dateKey)
  const { rows } = await q(
    `select l.id, l.type, l.day_part, l.start_time, l.end_time, l.start_date, l.end_date,
            t.label as type_label
       from leaves l
       left join leave_types t on t.key = l.type
      where l.user_id = $1 and l.kind = 'leave' and l.status = 'approved'
        and l.start_date <= $2 and l.end_date >= $2
      order by l.start_date`,
    [userId, day],
  )
  const row = rows.find(
    (r) => perDayFraction(r.day_part ?? 'full', r.start_time || '', r.end_time || '') >= 1,
  )
  if (!row) return null
  return {
    id: row.id,
    type: row.type,
    label: row.type_label ?? row.type,
    startDate: dayKey(row.start_date),
    endDate: dayKey(row.end_date),
  }
}

/**
 * The same question as approvedFullDayLeaveOn, asked for many people at once:
 * who among `userIds` is on approved full-day leave on `dateKey`. One query
 * instead of one per person — what the admin/manager daily check-in roll-call
 * uses to tell "on leave" apart from "hasn't checked in".
 * @returns {Promise<Map<string, {id,type,label,startDate,endDate}>>} keyed by user id
 */
export async function approvedFullDayLeavesOn(userIds, dateKey) {
  const byUser = new Map()
  if (!userIds.length) return byUser
  const day = startOfDay(dateKey)
  const { rows } = await q(
    `select l.user_id, l.id, l.type, l.day_part, l.start_time, l.end_time,
            l.start_date, l.end_date, t.label as type_label
       from leaves l
       left join leave_types t on t.key = l.type
      where l.user_id = any($1::uuid[]) and l.kind = 'leave' and l.status = 'approved'
        and l.start_date <= $2 and l.end_date >= $2
      order by l.start_date`,
    [userIds, day],
  )
  for (const row of rows) {
    if (byUser.has(row.user_id)) continue
    if (perDayFraction(row.day_part ?? 'full', row.start_time || '', row.end_time || '') < 1) continue
    byUser.set(row.user_id, {
      id: row.id,
      type: row.type,
      label: row.type_label ?? row.type,
      startDate: dayKey(row.start_date),
      endDate: dayKey(row.end_date),
    })
  }
  return byUser
}

/** "3 days", "1 day", or for fractions "2h (0.25 day)" / "4h 30m (0.5625 day)". */
export function describeAmount(days) {
  const d = round4(days)
  if (Number.isInteger(d)) return `${d} day${d === 1 ? '' : 's'}`
  const totalMinutes = Math.round(d * DAY_HOURS * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}h${m ? ` ${m}m` : ''} (${d} day${d === 1 ? '' : 's'})`
}

/** UTC instant range [from, toExclusive) of the period containing `refKey`. */
export function periodRange(period, refKey = dayKey()) {
  const [y, m] = refKey.split('-').map(Number)
  if (period === 'day') {
    const from = startOfDay(refKey)
    return { from, toExclusive: new Date(from.getTime() + 86400000) }
  }
  if (period === 'month') {
    // Date.UTC months are 0-based, so (y, m - 1) is this month and (y, m)
    // rolls to the first of the next — no "-31 in February" edge cases.
    return { from: new Date(Date.UTC(y, m - 1, 1)), toExclusive: new Date(Date.UTC(y, m, 1)) }
  }
  return { from: new Date(Date.UTC(y, 0, 1)), toExclusive: new Date(Date.UTC(y + 1, 0, 1)) }
}

/** Approved days of `typeKey` starting inside the period containing `refKey`. */
export async function usedDaysInPeriod(userId, typeKey, period, refKey, client = null) {
  const { from, toExclusive } = periodRange(period, refKey)
  const { rows } = await (client ?? { query: q }).query(
    `select coalesce(sum(days), 0) as used
       from leaves
      where user_id = $1 and kind = 'leave' and type = $2 and status = 'approved'
        and start_date >= $3 and start_date < $4`,
    [userId, typeKey, from, toExclusive],
  )
  return round4(rows[0].used)
}

/** The user's granted days for a type: their frozen snapshot, falling back to
 *  the current employment-type policy for types added after they were hired. */
export function quotaDaysFor(u, typeKey, employmentTypes) {
  const frozen = Number(u.leaveQuotas?.[typeKey])
  if (Number.isFinite(frozen) && u.leaveQuotas?.[typeKey] !== undefined) return frozen
  const et = employmentTypes?.find((t) => t.id === u.employmentTypeId)
  return Number(et?.quotas?.[typeKey]) || 0
}

/**
 * Would this request overdraw a day/month-period allowance? `dates` are the
 * requested 'YYYY-MM-DD' keys, each consuming `perDay` days. Returns an error
 * string, or null when the request fits every touched period. Callers pass
 * `client` to run inside the approval transaction (the user row is locked
 * there, so two concurrent approvals for one person can't both pass).
 */
export async function periodOverdraft({ userId, type, quotaDays, dates, perDay, client = null }) {
  const requestedByPeriod = new Map()
  for (const d of dates) {
    const key = periodRange(type.period, d).from.toISOString()
    const entry = requestedByPeriod.get(key) ?? { refKey: d, requested: 0 }
    entry.requested = round4(entry.requested + perDay)
    requestedByPeriod.set(key, entry)
  }
  for (const { refKey, requested } of requestedByPeriod.values()) {
    const used = await usedDaysInPeriod(userId, type.key, type.period, refKey, client)
    if (requested + used > quotaDays + 1e-9) {
      const left = round4(Math.max(0, quotaDays - used))
      return (
        `${type.label} is limited to ${describeAmount(quotaDays)} per ${type.period}. ` +
        (left > 0
          ? `You have ${describeAmount(left)} left in the ${type.period} of ${refKey}.`
          : `The allowance for the ${type.period} of ${refKey} is fully used.`)
      )
    }
  }
  return null
}

/**
 * Effective per-type balances and quotas for DISPLAY, mutating and returning
 * `u`. Year types keep their stored counter (gap-filled via
 * ensureLeaveBalances); day/month types get this period's remaining computed
 * fresh. Quota gaps are merged in-memory only — persistence of counters stays
 * with the callers that already do it. One small query per period-type per
 * call; fine at this project's scale.
 */
export async function resolveLeaveBalances(u) {
  const { changed } = await ensureLeaveBalances(u)
  const [allTypes, employmentTypes] = await Promise.all([
    cachedLeaveTypes(),
    cachedEmploymentTypes(),
  ])
  u.leaveQuotas = { ...(u.leaveQuotas || {}) }
  for (const t of allTypes.filter((x) => x.active)) {
    const quotaDays = quotaDaysFor(u, t.key, employmentTypes)
    if (u.leaveQuotas[t.key] === undefined) u.leaveQuotas[t.key] = quotaDays
    if (t.period === 'year') continue
    const used = await usedDaysInPeriod(u.id, t.key, t.period, dayKey())
    u.leaveBalances[t.key] = round4(Math.max(0, quotaDays - used))
  }
  return { changed }
}
