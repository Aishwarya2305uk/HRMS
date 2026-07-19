/** Small display formatters shared across the dashboard. */

const pad = (n) => String(n).padStart(2, '0')

/** Seconds -> "HH:MM:SS" for the live timer. */
export function formatElapsed(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

/** Seconds -> "8h 12m" for tables/summaries. */
export function formatHours(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h ${pad(m)}m`
}

/** ISO date/string -> "Jul 22" (or "Jul 22, 2026" with year). */
export function formatDate(value, withYear = false) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  })
}

/** ISO datetime -> "09:04 AM" clock time, or "—" when absent. */
export function formatTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** A leave's date range as "Jul 22 – Jul 23" (single day collapses to one). */
export function formatRange(start, end) {
  const a = formatDate(start)
  const b = formatDate(end)
  return a === b ? a : `${a} – ${b}`
}
