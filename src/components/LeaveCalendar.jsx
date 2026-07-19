import { useCallback, useEffect, useState } from 'react'
import { haptic } from '../lib/haptics'
import { leaves as leavesApi } from '../lib/hrms'
import { InlineError } from './States'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

/**
 * Monthly leave calendar: shows the current user's own leaves plus the
 * company-wide "who's on approved leave" view. Data comes from
 * /leaves/calendar?month=YYYY-MM.
 */
export default function LeaveCalendar() {
  const [month, setMonth] = useState(() => monthKey(new Date()))
  const [days, setDays] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

  const [year, mon] = month.split('-').map(Number)
  const firstWeekday = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const todayKey = new Date().toISOString().slice(0, 10)

  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${month}-${String(d).padStart(2, '0')}`)
  }

  return (
    <section className="card pop" style={{ '--d': '120ms' }}>
      <div className="attendance__head">
        <h2>Leave calendar</h2>
        <div className="cal-nav">
          <button className="icon-btn sm" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <span className="cal-month">{monthLabel(month)}</span>
          <button className="icon-btn sm" onClick={() => shift(1)} aria-label="Next month">›</button>
        </div>
      </div>

      {error && <InlineError onRetry={load}>{error.message}</InlineError>}

      <div className={`cal-grid${loading ? ' is-loading' : ''}`} aria-busy={loading}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-weekday">{w}</div>
        ))}
        {cells.map((key, i) => {
          if (!key) return <div key={`e${i}`} className="cal-cell empty" />
          const entries = days[key] || []
          const mine = entries.filter((e) => e.self)
          const others = entries.filter((e) => !e.self)
          const dayNum = Number(key.slice(-2))
          return (
            <div key={key} className={`cal-cell${key === todayKey ? ' today' : ''}${mine.length ? ' has-mine' : ''}`}>
              <span className="cal-date">{dayNum}</span>
              <div className="cal-dots">
                {mine.map((e, j) => (
                  <span key={`m${j}`} className={`cal-dot mine ${e.kind}`} title={`You · ${e.type}`} />
                ))}
                {others.length > 0 && (
                  <span className="cal-others" title={others.map((o) => o.name).join(', ')}>
                    +{others.length}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="cal-legend">
        <span><i className="cal-dot mine leave" /> Your approved leave</span>
        <span><i className="cal-dot mine pending" /> Your pending</span>
        <span><i className="cal-dot mine auto-leave" /> Auto-leave (&lt;8h)</span>
        <span><i className="cal-others static">+n</i> Others on leave</span>
      </div>
    </section>
  )
}
