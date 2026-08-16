/**
 * Time helpers. Day boundaries are computed in UTC so behavior is identical in
 * local dev and on the hosted server (which runs in UTC) — the whole app
 * agrees on what "today" and "end of day" mean.
 */

/** 'YYYY-MM-DD' key for the calendar day a Date falls in (UTC). */
export function dayKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10)
}

/** Last instant (23:59:59.999 UTC) of the given 'YYYY-MM-DD' day. */
export function endOfDay(dateKey) {
  return new Date(`${dateKey}T23:59:59.999Z`)
}

/** First instant (00:00:00.000 UTC) of the given 'YYYY-MM-DD' day. */
export function startOfDay(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`)
}

/** Inclusive number of calendar days between two 'YYYY-MM-DD' keys — Sundays included; see workingDays(). */
export function inclusiveDays(startKey, endKey) {
  const a = startOfDay(startKey).getTime()
  const b = startOfDay(endKey).getTime()
  return Math.floor((b - a) / 86400000) + 1
}

/** Every 'YYYY-MM-DD' key in the inclusive range [startKey, endKey]. */
export function dateKeysInRange(startKey, endKey) {
  const keys = []
  let t = startOfDay(startKey).getTime()
  const end = startOfDay(endKey).getTime()
  while (t <= end) {
    keys.push(dayKey(new Date(t)))
    t += 86400000
  }
  return keys
}

/**
 * Weekly off: Sunday is the one non-working day (v1 — no per-org weekend or
 * holiday configuration yet). Leave and WFH requests skip weekly offs: they
 * can't start or end on one and one inside a range isn't counted, since
 * there's no work to be away from. The client mirrors this in lib/leave.js.
 */
export function isWeeklyOff(dateKey) {
  return startOfDay(dateKey).getUTCDay() === 0 // 0 = Sunday (UTC, like every day key)
}

/** The keys in [startKey, endKey] that are working days (weekly offs skipped). */
export function workingDayKeysInRange(startKey, endKey) {
  return dateKeysInRange(startKey, endKey).filter((k) => !isWeeklyOff(k))
}

/** Number of working days in the inclusive range — what a leave/WFH request is sized by. */
export function workingDays(startKey, endKey) {
  return workingDayKeysInRange(startKey, endKey).length
}

/** 'YYYY-MM-DD' of the Monday (UTC) that starts the week containing this day key. */
export function weekStartOf(dateKey) {
  const d = startOfDay(dateKey)
  const dow = d.getUTCDay() // 0=Sun..6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow
  d.setUTCDate(d.getUTCDate() + diffToMonday)
  return dayKey(d)
}
