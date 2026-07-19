/**
 * Time helpers. Day boundaries are computed in UTC so behavior is identical in
 * local dev and on serverless (which runs in UTC) — the whole app agrees on
 * what "today" and "end of day" mean.
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

/** Inclusive number of calendar days between two 'YYYY-MM-DD' keys (v1 counts weekends). */
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
