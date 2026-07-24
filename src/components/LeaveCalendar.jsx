import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import Modal from './Modal'
import { haptic, tactile } from '../lib/haptics'
import { leaves as leavesApi } from '../lib/hrms'
import { formatRange, formatDate } from '../lib/format'
import { InlineError } from './States'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Entries shown directly in a cell before the rest collapse into a "+N" chip. */
const MAX_VISIBLE_CHIPS = 2

const STATUS_LABEL = {
  approved: 'Approved',
  pending: 'Pending',
  rejected: 'Rejected',
  'auto-leave': 'Auto-leave',
}

/** 'YYYY-MM' for a Date (UTC month, to match the server's day keys). */
function monthKey(date) {
  return date.toISOString().slice(0, 7)
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}
/** 'YYYY-MM-DD' -> "Wednesday, 22 July 2026", always in the calendar's own UTC
 *  day grid (not the viewer's local timezone, which could shift it a day). */
function dayLongLabel(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
/** Weekday index (0=Sun..6=Sat) for a 'YYYY-MM-DD' key, in the calendar's own UTC grid. */
function weekdayOf(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
/** "Priya Shah" -> "PS", for the compact teammate avatar chip. */
function initials(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')
}

/**
 * Monthly leave calendar: a full dedicated page (not a cramped widget) that
 * shows the current user's own leaves plus the company-wide "who's on
 * approved leave" view, per HRMS_v1_Requirements.md §4.5. Data comes from
 * /leaves/calendar?month=YYYY-MM.
 *
 * Every entry chip is clickable and opens the complete detail for that leave
 * (type, exact dates, day count, status, and — for the viewer's own leaves —
 * the reason and any manager decision note). A teammate's reason is
 * deliberately withheld here: the requirements keep the company-wide view to
 * "names/count", and a leave's reason is personal justification meant for the
 * employee and their direct manager, not every coworker who opens the calendar.
 */
export default function LeaveCalendar({ typeLabels = {} }) {
  const [month, setMonth] = useState(() => monthKey(new Date()))
  const [days, setDays] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dayModalKey, setDayModalKey] = useState(null)
  const [detailEntry, setDetailEntry] = useState(null)

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    leavesApi
      .calendar(month)
      .then((res) => {
        if (!cancelled) setDays(res.days || {})
      })
      .catch((err) => {
        // Without this the month would silently render as "nobody on leave",
        // which is worse than saying we couldn't load it.
        if (!cancelled) {
          setError(err)
          setDays({})
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [month])

  useEffect(() => load(), [load])

  function shift(delta) {
    haptic('light')
    const [y, m] = month.split('-').map(Number)
    setMonth(monthKey(new Date(Date.UTC(y, m - 1 + delta, 1))))
  }
  function goToday() {
    haptic('light')
    setMonth(monthKey(new Date()))
  }
  function openEntry(entry) {
    haptic('light')
    setDetailEntry(entry)
  }
  function openDay(key) {
    haptic('light')
    setDayModalKey(key)
  }

  const [year, mon] = month.split('-').map(Number)
  const firstWeekday = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const todayKey = new Date().toISOString().slice(0, 10)

  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${month}-${String(d).padStart(2, '0')}`)
  }

  /** Month-at-a-glance summary — the "every detail" ask, distilled to three
   *  numbers a manager or employee actually scans for. */
  const stats = useMemo(() => {
    let approvedDays = 0
    const pendingIds = new Set()
    const teammates = new Set()
    for (const entries of Object.values(days)) {
      for (const e of entries) {
        if (e.self) {
          if (e.kind === 'leave') approvedDays++
          if (e.kind === 'pending') pendingIds.add(e.id)
        } else {
          teammates.add(e.name)
        }
      }
    }
    return { approvedDays, pendingCount: pendingIds.size, teammatesOnLeave: teammates.size }
  }, [days])

  return (
    <section className="cal-page pop" style={{ '--d': '120ms' }}>
      <header className="cal-page__head">
        <div>
          <h2>Leave calendar</h2>
          <p className="cal-page__subtitle">Your leave status and who else is out, at a glance.</p>
        </div>
        <div className="cal-nav">
          <button type="button" className="btn-tactile ghost sm" onClick={goToday}>
            Today
          </button>
          <button type="button" className="icon-btn sm" onClick={() => shift(-1)} aria-label="Previous month">
            ‹
          </button>
          <span className="cal-month">{monthLabel(month)}</span>
          <button type="button" className="icon-btn sm" onClick={() => shift(1)} aria-label="Next month">
            ›
          </button>
        </div>
      </header>

      {error && <InlineError onRetry={load}>{error.message}</InlineError>}

      <div className="cal-stats">
        <div className="cal-stat">
          <span className="cal-stat__icon leave"><Icon name="check" size={17} /></span>
          <div>
            <strong>{stats.approvedDays}</strong>
            <span>Your approved leave days</span>
          </div>
        </div>
        <div className="cal-stat">
          <span className="cal-stat__icon pending"><Icon name="clock" size={17} /></span>
          <div>
            <strong>{stats.pendingCount}</strong>
            <span>Your pending requests</span>
          </div>
        </div>
        <div className="cal-stat">
          <span className="cal-stat__icon others"><Icon name="users" size={17} /></span>
          <div>
            <strong>{stats.teammatesOnLeave}</strong>
            <span>Teammates on leave</span>
          </div>
        </div>
      </div>

      <div className="cal-weekdays">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`cal-weekday${i === 0 || i === 6 ? ' weekend' : ''}`}>
            {w}
          </div>
        ))}
      </div>

      <div className={`cal-grid${loading ? ' is-loading' : ''}`} aria-busy={loading}>
        {cells.map((key, i) => {
          if (!key) return <div key={`e${i}`} className="cal-cell empty" />
          const entries = days[key] || []
          const mine = entries.filter((e) => e.self)
          const dayNum = Number(key.slice(-2))
          const isWeekend = weekdayOf(key) === 0 || weekdayOf(key) === 6
          const visible = entries.slice(0, MAX_VISIBLE_CHIPS)
          const overflow = entries.length - visible.length

          return (
            <div
              key={key}
              className={`cal-cell${key === todayKey ? ' today' : ''}${mine.length ? ' has-mine' : ''}${isWeekend ? ' weekend' : ''}`}
            >
              <button
                type="button"
                className="cal-date"
                onClick={() => openDay(key)}
                disabled={entries.length === 0}
                aria-label={
                  entries.length
                    ? `${dayLongLabel(key)} — ${entries.length} leave ${entries.length === 1 ? 'entry' : 'entries'}, view details`
                    : undefined
                }
              >
                {dayNum}
              </button>
              {entries.length > 0 && (
                <div className="cal-chips">
                  {visible.map((e, j) => (
                    <button
                      key={e.id ? `${e.id}-${j}` : j}
                      type="button"
                      className={`cal-chip ${e.self ? 'mine' : 'other'}`}
                      onClick={() => openEntry(e)}
                      title={e.self ? `You · ${typeLabels[e.type] ?? e.type}` : `${e.name} · ${typeLabels[e.type] ?? e.type}`}
                      {...tactile('light')}
                    >
                      {e.self ? (
                        <i className={`cal-dot mine ${e.kind}`} aria-hidden="true" />
                      ) : (
                        <i className="cal-avatar" aria-hidden="true">{initials(e.name)}</i>
                      )}
                      <span>{e.self ? 'You' : e.name}</span>
                    </button>
                  ))}
                  {overflow > 0 && (
                    <button
                      type="button"
                      className="cal-chip more"
                      onClick={() => openDay(key)}
                      aria-label={`${overflow} more on leave — view all`}
                    >
                      +{overflow}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="cal-legend">
        <span><i className="cal-dot mine leave" /> Your approved leave</span>
        <span><i className="cal-dot mine pending" /> Your pending</span>
        <span><i className="cal-dot mine rejected" /> Your rejected</span>
        <span><i className="cal-dot mine auto-leave" /> Auto-leave (&lt;8h)</span>
        <span><i className="cal-avatar sm" aria-hidden="true">PS</i> Teammate on leave</span>
        <span className="cal-legend__hint">Click any day or entry for full details</span>
      </div>

      {dayModalKey && (
        <Modal titleId="cal-day-title" onClose={() => setDayModalKey(null)}>
          <div className="modal__head">
            <h2 id="cal-day-title">{dayLongLabel(dayModalKey)}</h2>
            <button className="icon-btn sm" onClick={() => setDayModalKey(null)} aria-label="Close dialog">
              ✕
            </button>
          </div>
          {(days[dayModalKey] || []).length === 0 ? (
            <p className="cal-day-empty">No leave on this day.</p>
          ) : (
            <ul className="cal-day-list">
              {(days[dayModalKey] || []).map((e, i) => (
                <li key={e.id ? `${e.id}-${i}` : i}>
                  <LeaveDetailBody entry={e} typeLabels={typeLabels} />
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {detailEntry && (
        <Modal titleId="cal-entry-title" onClose={() => setDetailEntry(null)}>
          <div className="modal__head">
            <h2 id="cal-entry-title">{detailEntry.self ? 'Your leave' : `${detailEntry.name}'s leave`}</h2>
            <button className="icon-btn sm" onClick={() => setDetailEntry(null)} aria-label="Close dialog">
              ✕
            </button>
          </div>
          <LeaveDetailBody entry={detailEntry} typeLabels={typeLabels} />
        </Modal>
      )}
    </section>
  )
}

/** Full detail for one calendar entry — the click-through target from both a
 *  single chip and the day-overview list, so the two surfaces never drift. */
function LeaveDetailBody({ entry, typeLabels }) {
  const isAttendance = entry.type === 'attendance'
  return (
    <div className="leave-detail">
      <div className="leave-detail__row">
        <span className={`avatar sm ${entry.self ? 'tint-indigo' : 'tint-blue'}`} aria-hidden="true">
          {entry.self ? 'Y' : initials(entry.name)}
        </span>
        <div className="leave-detail__who">
          <strong>{entry.self ? 'You' : entry.name}</strong>
          <em>{isAttendance ? 'Automatic — attendance rule' : typeLabels[entry.type] ?? entry.type}</em>
        </div>
        <span className={`status ${entry.status}`}>{STATUS_LABEL[entry.status] ?? entry.status}</span>
      </div>

      <dl className="leave-detail__facts">
        <div>
          <dt>Dates</dt>
          <dd>{formatRange(entry.startDate, entry.endDate)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{entry.days} {entry.days === 1 ? 'day' : 'days'}</dd>
        </div>
        {entry.createdAt && (
          <div>
            <dt>Applied</dt>
            <dd>{formatDate(entry.createdAt, true)}</dd>
          </div>
        )}
      </dl>

      {entry.self ? (
        <p className="leave-detail__reason">
          <strong>Reason</strong>
          {entry.reason ? entry.reason : <em>No reason given.</em>}
        </p>
      ) : (
        <p className="leave-detail__reason muted">
          <em>The reason is only visible to {entry.name} and their manager.</em>
        </p>
      )}

      {entry.decisionComment && (
        <p className="leave-detail__reason">
          <strong>Manager's note</strong>
          {entry.decisionComment}
        </p>
      )}
    </div>
  )
}
