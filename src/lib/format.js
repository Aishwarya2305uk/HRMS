/** Small display formatters shared across the dashboard. */

const pad = (n) => String(n).padStart(2, '0')

/** What a leave/WFH/attendance-fix request is called, wherever one renders
 *  (approval queues, notifications, admin tables). */
export function requestLabel(request, typeLabels = {}) {
  if (request.kind === 'wfh') return 'Work from home'
  if (request.kind === 'regularize') return 'Attendance fix'
  return typeLabels[request.type] ?? request.type
}

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

/** 'HH:MM' (24h) -> "9:00 AM" clock time, or '' when absent/malformed. */
export function formatClock(hhmm) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return ''
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h < 12 ? 'AM' : 'PM'
  const hour12 = h % 12 || 12
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`
}

/** A request's day-part as a short label ('full' renders as nothing). */
export function dayPartLabel(dayPart) {
  if (dayPart === 'first') return 'First half'
  if (dayPart === 'second') return 'Second half'
  return ''
}

/**
 * A leave amount (stored in days, 8h = 1 day) in human units: whole days as
 * "3 days"; anything fractional leads with hours — "4h (0.5 days)",
 * "1h 30m (0.1875 days)" — since sub-day leave is taken in hours.
 */
export function formatLeaveAmount(days) {
  const d = Math.round((Number(days) || 0) * 10000) / 10000
  if (Number.isInteger(d)) return `${d} day${d === 1 ? '' : 's'}`
  const totalMinutes = Math.round(d * 8 * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}h${m ? ` ${m}m` : ''} (${d} day${d === 1 ? '' : 's'})`
}

/** The same amount hours-first and compact, for the hours-scaled bar graph: "96h", "4h 30m". */
export function formatLeaveHoursOnly(days) {
  const totalMinutes = Math.round((Number(days) || 0) * 8 * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/**
 * One-line summary of a leave/WFH request's window:
 * "Jul 22 – Jul 24 · 3 days · 9:00 AM – 6:00 PM". Half days show their part
 * instead of a count ("Jul 22 · First half · 9:00 AM – 1:30 PM"); custom-time
 * requests show their hours-based size ("Jul 22 · 2h (0.25 days) · 10:00 AM –
 * 12:00 PM"); requests from before times existed simply omit the clock segment.
 */
export function formatRequestWindow(r) {
  const parts = [formatRange(r.startDate, r.endDate)]
  parts.push(dayPartLabel(r.dayPart) || formatLeaveAmount(r.days))
  const from = formatClock(r.startTime)
  const to = formatClock(r.endTime)
  if (from && to) parts.push(`${from} – ${to}`)
  return parts.join(' · ')
}

/** Bytes -> "312 KB" / "2.4 MB" for document sizes. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** ISO datetime -> "Just now" / "12m ago" / "3h ago" / "2d ago", falling back to formatDate past a week. */
export function formatRelativeTime(value) {
  if (!value) return ''
  const diffMs = Date.now() - new Date(value).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(value)
}
