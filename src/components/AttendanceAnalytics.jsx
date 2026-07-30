import { useMemo } from 'react'
import Icon from './Icon'
import { tactile } from '../lib/haptics'
import { formatHours } from '../lib/format'
import { EmptyState } from './States'

const HEAT_ROW_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']
const STAT_ICON = { present: 'check', avg: 'clock', total: 'barChart', streak: 'flame' }

/** 'YYYY-MM-DD' -> "22 Jul", in the data's own UTC day grid (not the viewer's
 *  local timezone, which could shift a day near midnight — same reasoning as
 *  LeaveCalendar's day labels). */
function dayShortLabel(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}
function dayLongLabel(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}
/** Monday-start weekday index (0=Mon..6=Sun) for a 'YYYY-MM-DD' key. */
function mondayIndexOf(key) {
  const [y, m, d] = key.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun..6=Sat
  return dow === 0 ? 6 : dow - 1
}
function addDaysKey(key, delta) {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

/**
 * The current user's own attendance analytics: KPI tiles, a weekly hours
 * trend chart, and a day-by-day heatmap. Everything here is a *view* over
 * numbers the server already computed (GET /attendance/analytics) — no
 * worked-time math happens on the client.
 *
 * @param {object} props.data  the analytics endpoint's response
 *   ({ range, summary, daily, weekly })
 */
export default function AttendanceAnalytics({ data }) {
  const { range, summary, daily, weekly } = data

  const byDate = useMemo(() => Object.fromEntries(daily.map((d) => [d.date, d])), [daily])
  const todayKey = useMemo(() => new Date().toISOString().slice(0, 10), [])

  // Pad out to a Monday-start grid of full weeks, like LeaveCalendar's
  // leading blanks, so the heatmap's rows line up with the weekday labels.
  const heatWeeks = useMemo(() => {
    const leadingPad = mondayIndexOf(range.from)
    const gridStart = addDaysKey(range.from, -leadingPad)
    const spanDays = Math.round((new Date(range.to) - new Date(gridStart)) / 86400000) + 1
    const weeks = []
    for (let i = 0; i < spanDays; i += 7) {
      const week = []
      for (let j = 0; j < 7; j++) {
        const key = addDaysKey(gridStart, i + j)
        week.push(key < range.from || key > range.to ? null : key)
      }
      weeks.push(week)
    }
    return weeks
  }, [range.from, range.to])

  const maxWeekSeconds = useMemo(
    () => weekly.reduce((max, w) => Math.max(max, w.totalWorkedSeconds), 0),
    [weekly],
  )

  if (summary.loggedDays === 0) {
    return (
      <section className="card pop analytics" style={{ '--d': '200ms' }}>
        <div className="attendance__head">
          <h2>Attendance analytics</h2>
        </div>
        <EmptyState
          icon="barChart"
          title="Nothing to analyze yet"
          message="Check in at least once and your trends, streaks and day-by-day view will show up here."
        />
      </section>
    )
  }

  const tiles = [
    {
      key: 'present',
      tint: 'green',
      label: 'Present days',
      value: summary.presentDays,
      unit: `/ ${summary.loggedDays}`,
    },
    {
      key: 'avg',
      tint: 'blue',
      label: 'Avg. hours / day',
      value: formatHours(summary.avgWorkedSecondsPerDay),
      unit: '',
    },
    {
      key: 'total',
      tint: 'indigo',
      label: 'Total hours logged',
      value: formatHours(summary.totalWorkedSeconds),
      unit: '',
    },
    {
      key: 'streak',
      tint: 'amber',
      label: 'Current streak',
      value: summary.currentStreak,
      unit: summary.currentStreak === 1 ? 'day' : 'days',
    },
  ]

  const colWidth = 46
  const chartW = Math.max(weekly.length * colWidth, colWidth)
  const chartH = 150
  const barAreaH = 96
  const baseY = chartH - 28
  const spanDays = Math.round((new Date(range.to) - new Date(range.from)) / 86400000) + 1

  return (
    <section className="card pop analytics" style={{ '--d': '200ms' }}>
      <div className="attendance__head">
        <h2>Attendance analytics</h2>
        <span className="cal-page__subtitle">
          {dayShortLabel(range.from)} – {dayShortLabel(range.to)}
        </span>
      </div>

      <section className="stat-row">
        {tiles.map((t) => (
          <article
            key={t.key}
            className={`stat tint-${t.tint}`}
            tabIndex={0}
            {...tactile('light')}
          >
            <span className="stat__icon">
              <Icon name={STAT_ICON[t.key]} size={20} />
            </span>
            <div className="stat__meta">
              <span className="stat__label">{t.label}</span>
              <span className="stat__value">
                {t.value}
                {t.unit && <em>{t.unit}</em>}
              </span>
            </div>
          </article>
        ))}
      </section>

      <div className="analytics__charts">
        <div className="analytics__block">
          <h3>Hours worked per week</h3>
          {weekly.length === 0 ? (
            <p className="analytics__muted">Not enough data yet.</p>
          ) : (
            <svg
              viewBox={`0 0 ${chartW} ${chartH}`}
              className="analytics__bars"
              role="img"
              aria-label="Hours worked per week"
              preserveAspectRatio="xMinYMid meet"
            >
              <line x1="0" y1={baseY} x2={chartW} y2={baseY} className="analytics__baseline" />
              {weekly.map((w, i) => {
                const hours = w.totalWorkedSeconds / 3600
                const h = maxWeekSeconds ? (w.totalWorkedSeconds / maxWeekSeconds) * barAreaH : 0
                const x = i * colWidth + 8
                return (
                  <g key={w.weekStart}>
                    <title>{`Week of ${dayShortLabel(w.weekStart)} — ${formatHours(w.totalWorkedSeconds)}`}</title>
                    <rect
                      x={x}
                      y={baseY - h}
                      width={colWidth - 16}
                      height={Math.max(h, 2)}
                      rx={5}
                      className="analytics__bar"
                    />
                    <text
                      x={x + (colWidth - 16) / 2}
                      y={Math.max(baseY - h - 6, 10)}
                      textAnchor="middle"
                      className="analytics__bar-label"
                    >
                      {hours > 0 ? Math.round(hours) : ''}
                    </text>
                    <text
                      x={x + (colWidth - 16) / 2}
                      y={chartH - 8}
                      textAnchor="middle"
                      className="analytics__axis-label"
                    >
                      {dayShortLabel(w.weekStart)}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>

        <div className="analytics__block">
          <h3>Last {spanDays} days</h3>
          <div className="heatmap-wrap">
            <div className="heatmap-rows">
              {HEAT_ROW_LABELS.map((label, i) => (
                <span key={i} className="heatmap-rowlabel">
                  {label}
                </span>
              ))}
            </div>
            <div className="heatmap">
              {heatWeeks.map((week, wi) => (
                <div className="heatmap__col" key={wi}>
                  {week.map((key, di) => {
                    if (!key) return <span key={di} className="heat-cell is-pad" aria-hidden="true" />
                    const entry = byDate[key]
                    const cls = !entry
                      ? 'is-empty'
                      : entry.status === 'active'
                        ? 'is-open'
                        : entry.dayStatus === 'present'
                          ? 'is-present'
                          : 'is-short'
                    const detail = !entry
                      ? 'no session'
                      : entry.status === 'active'
                        ? `${formatHours(entry.workedSeconds)} so far (in progress)`
                        : `${formatHours(entry.workedSeconds)} · ${entry.dayStatus === 'present' ? 'Present' : 'Leave'}`
                    return (
                      <span
                        key={di}
                        className={`heat-cell ${cls}${key === todayKey ? ' is-today' : ''}`}
                        title={`${dayLongLabel(key)} — ${detail}`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="cal-legend heatmap-legend">
            <span>
              <i className="heat-cell is-present" /> Present
            </span>
            <span>
              <i className="heat-cell is-short" /> Short day
            </span>
            <span>
              <i className="heat-cell is-open" /> In progress
            </span>
            <span>
              <i className="heat-cell is-empty" /> No session
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
