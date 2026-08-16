import { useMemo } from 'react'
import { formatDate, formatHours, formatTime } from '../lib/format'
import { haptic } from '../lib/haptics'
import { useSessionState } from '../lib/useSessionState'
import { EmptyState } from './States'

/** 'YYYY-MM' for a Date (UTC month, to match the server's day keys). */
function monthKey(date) {
  return date.toISOString().slice(0, 7)
}
/** Today's 'YYYY-MM-DD' — UTC, the same day key the server stamps sessions with. */
const todayKey = () => new Date().toISOString().slice(0, 10)
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

const FILTER_LABELS = { all: 'All', present: 'Present', leave: 'Auto-leave', checkin: 'Check-in' }

/**
 * Admin company-wide attendance view: every employee's daily worked hours
 * and present/leave verdict for the selected month. The Check-in filter is
 * the arrival lens for ONE day — today by default: who has checked in so
 * far (timer or one-tap) and at what time, earliest first, including
 * still-running sessions that have no verdict yet. The header's date picker
 * narrows every card and the table to one specific day instead (with
 * check-in times shown); clearing it restores the month view (and Check-in
 * back to today).
 *
 * Whenever check-in times show, so does a "From" column: where the check-in
 * came from, as an IP address and the city/country that IP resolves to. That
 * lookup is city-level at best and wrong behind a VPN or mobile network — the
 * footnote under the table says so, since a location column reads as harder
 * evidence than it is.
 * @param {Array}  props.rows            from /attendance/all
 * @param {string} [props.searchQuery]   filters rows by employee name
 * @param {string} props.month           'YYYY-MM' currently selected
 * @param {Function} props.onMonthChange (nextMonth: string) => void
 */
export default function AllAttendance({ rows, searchQuery = '', month, onMonthChange }) {
  // Both survive a refresh (per tab) so the admin comes back to the same lens.
  const [filter, setFilter] = useSessionState('ui.allAttendance.filter', 'all')
  // '' = whole month; a 'YYYY-MM-DD' narrows every card and the table to that day.
  const [day, setDay] = useSessionState('ui.allAttendance.day', '')

  function shiftMonth(delta) {
    haptic('light')
    setDay('')
    const [y, m] = month.split('-').map(Number)
    onMonthChange(monthKey(new Date(Date.UTC(y, m - 1 + delta, 1))))
  }
  function pickDay(value) {
    haptic('light')
    setDay(value)
    // Picking a date in another month also navigates the fetch there.
    if (value && value.slice(0, 7) !== month) onMonthChange(value.slice(0, 7))
  }
  // Only narrow once the picked day's month is the one actually loaded —
  // right after a cross-month pick, `rows` still holds the previous month.
  const activeDay = day && day.startsWith(month) ? day : ''

  // Under a day lens the rows read like an arrival log: earliest check-in first.
  const dayRows = useMemo(() => {
    if (!activeDay) return rows
    return rows
      .filter((r) => r.date === activeDay)
      .sort((a, b) => {
        if (!a.checkInAt || !b.checkInAt) return a.checkInAt ? -1 : b.checkInAt ? 1 : 0
        return new Date(a.checkInAt) - new Date(b.checkInAt)
      })
  }, [rows, activeDay])
  const rowsWithStatus = useMemo(() => dayRows.filter((r) => r.dayStatus), [dayRows])
  // Check-in is a one-day arrival log: the picked date if there is one,
  // otherwise TODAY — never the whole month. Everyone who checked in that day
  // (timer or one-tap), earliest first, including still-running sessions,
  // which have no verdict yet and so never show under the status filters.
  const today = todayKey()
  const checkInDay = activeDay || today
  const checkedIn = useMemo(
    () =>
      dayRows
        .filter((r) => r.checkInAt && r.date === checkInDay)
        .sort((a, b) => new Date(a.checkInAt) - new Date(b.checkInAt)),
    [dayRows, checkInDay],
  )
  // Browsing a past/future month with no date picked: today isn't in `rows`,
  // so Check-in has nothing to show — say why instead of "no check-ins yet".
  const checkInDayOutOfView = !activeDay && !today.startsWith(month)
  const filtered = useMemo(() => {
    // With a specific day selected, "All" widens to every session that day —
    // in-progress ones included — instead of only days that already have a
    // verdict; hiding people who are checked in *right now* would defeat the
    // point of picking today.
    const base =
      filter === 'checkin'
        ? checkedIn
        : filter === 'all'
          ? activeDay
            ? dayRows
            : rowsWithStatus
          : rowsWithStatus.filter((r) => r.dayStatus === filter)
    const q = searchQuery.trim().toLowerCase()
    if (!q) return base
    return base.filter((r) => r.employeeName?.toLowerCase().includes(q))
  }, [dayRows, rowsWithStatus, checkedIn, filter, searchQuery, activeDay])
  const counts = useMemo(() => {
    const c = {
      all: activeDay ? dayRows.length : rowsWithStatus.length,
      present: 0,
      leave: 0,
      checkin: checkedIn.length,
    }
    for (const r of rowsWithStatus) c[r.dayStatus]++
    return c
  }, [dayRows, rowsWithStatus, checkedIn, activeDay])
  // Check-in times also show whenever one specific date is under the lens.
  const showCheckIn = filter === 'checkin' || Boolean(activeDay)

  return (
    <section className="card pop" style={{ '--d': '120ms' }}>
      <div className="attendance__head">
        <h2>All attendance</h2>
        <div className="attendance__head-actions">
          <div className="cal-nav">
            <input
              type="date"
              className="cal-date"
              value={day}
              onChange={(e) => pickDay(e.target.value)}
              aria-label="Show one specific date"
              title="Pick a date to see just that day (clear it for the whole month)"
            />
            <button
              type="button"
              className="icon-btn sm"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="cal-month">{monthLabel(month)}</span>
            <button
              type="button"
              className="icon-btn sm"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
          <div className="seg">
            {['all', 'present', 'leave', 'checkin'].map((s) => (
              <button
                key={s}
                className={`seg__btn${filter === s ? ' is-active' : ''}`}
                onClick={() => setFilter(s)}
              >
                {FILTER_LABELS[s]} <b>{counts[s]}</b>
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="clock"
          title={
            searchQuery.trim()
              ? 'No matches'
              : activeDay
                ? 'Nothing on this date'
                : filter === 'checkin'
                  ? checkInDayOutOfView
                    ? 'Check-in shows today'
                    : 'No check-ins yet today'
                  : 'No attendance recorded yet'
          }
          message={
            searchQuery.trim()
              ? `Nobody named "${searchQuery.trim()}" has attendance here.`
              : activeDay
                ? `No attendance was recorded on ${formatDate(activeDay, true)}. Clear the date to see the whole month.`
                : filter === 'checkin'
                  ? checkInDayOutOfView
                    ? `Today (${formatDate(today, true)}) isn't in ${monthLabel(month)}. Go to the current month, or pick a date above to see who checked in on a day in this month.`
                    : 'People will appear here the moment they check in today.'
                  : 'Company-wide attendance will appear here once people finish a day.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Date</th>
                {showCheckIn && <th>Check-in</th>}
                {showCheckIn && <th>From</th>}
                <th>Worked</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.employeeId}-${r.date}`}>
                  <td>
                    <div className="cell-name">
                      <span className="avatar sm" aria-hidden="true">{r.employeeName?.[0] ?? '?'}</span>
                      <strong>{r.employeeName}</strong>
                    </div>
                  </td>
                  <td>{r.department || '—'}</td>
                  <td>{formatDate(r.date, true)}</td>
                  {showCheckIn && <td>{formatTime(r.checkInAt)}</td>}
                  {showCheckIn && (
                    <td>
                      {r.checkInLocation || (r.checkInIp ? 'Unknown location' : '—')}
                      {r.checkInIp && <em className="cell-sub">{r.checkInIp}</em>}
                    </td>
                  )}
                  <td>{r.workedSeconds ? formatHours(r.workedSeconds) : '—'}</td>
                  <td>
                    {r.status === 'active' ? (
                      <span className="status pending">In progress</span>
                    ) : (
                      <span className={`status ${r.dayStatus === 'leave' ? 'auto-leave' : 'present'}`}>
                        {r.dayStatus === 'leave' ? 'Auto-leave (<8h)' : 'Present'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCheckIn && filtered.length > 0 && (
        <p className="attendance__note">
          "From" is estimated from the check-in IP address — approximate, and wrong on a VPN or
          mobile network.
        </p>
      )}
    </section>
  )
}
