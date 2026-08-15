/**
 * Client-side leave math, mirroring server/services/leavePolicy.js: request
 * sizes are hours-based with 8h = 1 day. The server re-validates everything —
 * these only exist for instant previews while filling the form.
 */
export const DAY_HOURS = 8
const DAY_MINUTES = DAY_HOURS * 60

/** Minutes in a 'HH:MM'–'HH:MM' window (0 when either side is missing/invalid). */
export function windowMinutes(startTime, endTime) {
  if (!/^\d{2}:\d{2}$/.test(startTime || '') || !/^\d{2}:\d{2}$/.test(endTime || '')) return 0
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  return eh * 60 + em - (sh * 60 + sm)
}

/**
 * Day fraction one requested date consumes. Presets are fixed (full = 1,
 * halves = 0.5); a custom window converts its hours at 8h = 1 day, capped at
 * one full day.
 */
export function perDayFraction(dayPart, startTime, endTime) {
  if (dayPart === 'full') return 1
  if (dayPart === 'first' || dayPart === 'second') return 0.5
  const minutes = Math.min(Math.max(0, windowMinutes(startTime, endTime)), DAY_MINUTES)
  return Math.round((minutes / DAY_MINUTES) * 10000) / 10000
}

/** 4-decimal rounding so summed fractions (0.125 steps) never drift. */
export const roundDays = (n) => Math.round(Number(n) * 10000) / 10000
