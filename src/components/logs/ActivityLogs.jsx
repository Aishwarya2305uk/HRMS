import { useCallback, useEffect, useRef, useState } from 'react'
import { activityLogs } from '../../lib/hrms'
import { haptic } from '../../lib/haptics'
import { useSessionState } from '../../lib/useSessionState'
import Avatar from '../Avatar'
import Icon from '../Icon'
import { Skeleton, ErrorState, EmptyState, InlineError } from '../States'

/** "Today, 14:32" / "Yesterday, 09:04" / "14 Aug 2026, 09:04" — an HR admin
 *  reads recency far faster than an absolute timestamp. */
function formatWhen(ts) {
  const d = new Date(ts)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const today = new Date()
  const sameDay = (a, b) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return `Today, ${time}`
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(d, yesterday)) return `Yesterday, ${time}`
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`
}

/** Tint per category, reusing the existing .tint-* palette. */
const CATEGORY_TINT = {
  Authentication: 'blue',
  'Employee Management': 'indigo',
  'Leave Management': 'green',
  Attendance: 'blue',
  Announcements: 'amber',
  Teams: 'indigo',
  Documents: 'amber',
  Policies: 'indigo',
  Settings: 'blue',
}

const DATE_OPTIONS = [
  ['30', 'Date: Last 30 days'],
  ['7', 'Last 7 days'],
  ['1', 'Last 24 hours'],
  ['90', 'Last 90 days'],
  ['365', 'Everything kept (1 year)'],
]
const STATUS_OPTIONS = [
  ['all', 'Status: All'],
  ['success', 'Successful'],
  ['failed', 'Failed'],
]

/**
 * Activity Logs — the HUMAN half of the audit story: one row per meaningful
 * thing somebody did in the HRMS, in a sentence an HR admin can read without
 * knowing what an endpoint is.
 *
 * The rows come from their own trail (GET /api/activity-logs), written by the
 * routes that perform the actions — NOT derived from the API log behind the
 * Advanced tab. One action there is usually several requests here, and the
 * detail that makes a sentence useful ("whose leave", "which announcement")
 * only exists inside the handler. See server/services/activityLog.js.
 *
 * Deliberately shows no method, path, status code or duration: everything
 * technical belongs in Advanced Logs. The one exception is the IP column,
 * which is here because "who signed in from where" is a question HR and
 * security genuinely ask of an audit trail.
 */
export default function ActivityLogs() {
  // The filter set survives a refresh (per tab), same as Advanced Logs.
  const [search, setSearch] = useSessionState('ui.activityLogs.search', '')
  const [category, setCategory] = useSessionState('ui.activityLogs.category', 'all')
  const [actor, setActor] = useSessionState('ui.activityLogs.actor', 'all')
  const [status, setStatus] = useSessionState('ui.activityLogs.status', 'all')
  const [days, setDays] = useSessionState('ui.activityLogs.days', '30')
  const [from, setFrom] = useSessionState('ui.activityLogs.from', '')
  const [to, setTo] = useSessionState('ui.activityLogs.to', '')

  const [rows, setRows] = useState(null)
  const [facets, setFacets] = useState({ categories: [], actors: [] })
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  // Guards a slow earlier response from overwriting a newer one.
  const runRef = useRef(0)

  const load = useCallback(async (filters) => {
    const runId = ++runRef.current
    setLoading(true)
    setError(null)
    try {
      const data = await activityLogs.list(filters)
      if (runId !== runRef.current) return
      setRows(data)
    } catch (err) {
      if (runId === runRef.current) setError(err)
    } finally {
      if (runId === runRef.current) setLoading(false)
    }
  }, [])

  // Categories come from the server registry, so adding a new activity type
  // in server/services/activityLog.js shows up here with no frontend change.
  useEffect(() => {
    let live = true
    activityLogs
      .filters()
      .then((f) => live && setFacets(f))
      .catch(() => {
        /* the dropdowns just stay minimal — never block the table on them */
      })
    return () => {
      live = false
    }
  }, [])

  const currentFilters = useCallback(
    () => ({ search: search.trim(), category, actor, status, days, from, to }),
    [search, category, actor, status, days, from, to],
  )

  // One effect covers first load and every filter change; typing debounces.
  useEffect(() => {
    const filters = { search: search.trim(), category, actor, status, days, from, to }
    const timer = setTimeout(() => load(filters), search ? 300 : 0)
    return () => clearTimeout(timer)
  }, [search, category, actor, status, days, from, to, load])

  function refresh() {
    haptic('light')
    load(currentFilters())
  }

  function clearFilters() {
    haptic('light')
    setSearch('')
    setCategory('all')
    setActor('all')
    setStatus('all')
    setDays('30')
    setFrom('')
    setTo('')
  }

  const filtersActive =
    Boolean(search.trim()) ||
    category !== 'all' ||
    actor !== 'all' ||
    status !== 'all' ||
    days !== '30' ||
    Boolean(from) ||
    Boolean(to)
  const failures = (rows ?? []).filter((r) => r.status === 'failed').length

  return (
    <>
      <div className="syslog__head">
        <p className="syslog__sub">
          What people actually did in Orbit, in plain language — one entry per real action, kept
          for a year. Anything technical (endpoints, status codes, timings) lives under Advanced
          Logs.
        </p>
        <button
          type="button"
          className="btn-tactile ghost sm syslog__refresh"
          onClick={refresh}
          disabled={loading}
        >
          <Icon name="refreshCw" size={14} />
          {loading && rows !== null ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="syslog__filters">
        <input
          className="syslog__search"
          type="search"
          placeholder="Search activity, person or record…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search activity by description, person or record"
        />
        <select
          className="mini-select"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by activity type"
        >
          <option value="all">Activity: All</option>
          {facets.categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          className="mini-select"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          aria-label="Filter by person"
        >
          <option value="all">User: Everyone</option>
          {facets.actors.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select
          className="mini-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map(([v, text]) => (
            <option key={v} value={v}>{text}</option>
          ))}
        </select>
        {/* The rolling window and an explicit range are alternatives, not a
            pair — picking dates disables the dropdown so they can't contradict
            each other (the server ignores `days` when a range is sent). */}
        <select
          className="mini-select"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          disabled={Boolean(from || to)}
          aria-label="Filter by date range"
        >
          {DATE_OPTIONS.map(([v, text]) => (
            <option key={v} value={v}>{text}</option>
          ))}
        </select>
        <input
          type="date"
          className="cal-date"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From date"
          title="From date"
        />
        <input
          type="date"
          className="cal-date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
          title="To date"
        />
        {filtersActive && (
          <button type="button" className="link-btn" onClick={clearFilters}>
            Clear filters
          </button>
        )}
        {rows !== null && (
          <span className="syslog__count" role="status">
            {rows.length} {rows.length === 1 ? 'activity' : 'activities'}
            {failures > 0 && <> · <b>{failures} failed</b></>}
          </span>
        )}
      </div>

      {error && rows !== null && (
        <InlineError onRetry={refresh}>These rows may be stale — {error.message}</InlineError>
      )}

      {rows === null ? (
        error ? (
          <ErrorState message={error.message} onRetry={refresh} retrying={loading} />
        ) : (
          <Skeleton rows={6} />
        )
      ) : rows.length === 0 ? (
        <EmptyState
          icon="activity"
          title={filtersActive ? 'No matching activity' : 'No activity recorded yet'}
          message={
            filtersActive
              ? 'Nothing in the activity trail matches these filters.'
              : 'Actions people take — signing in, applying for leave, approving requests — will appear here.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table activity__table">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Activity</th>
                <th>What happened</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="activity__when">{formatWhen(r.ts)}</td>
                  <td>
                    <div className="cell-name">
                      <Avatar name={r.actorName} size="sm" />
                      <div>
                        <strong>{r.actorName}</strong>
                        <em>{r.actorRole ?? '—'}</em>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`activity__badge tint-${CATEGORY_TINT[r.category] ?? 'indigo'}`}>
                      <Icon name={r.icon} size={13} />
                      {r.label}
                    </span>
                    <em className="activity__cat">{r.category}</em>
                  </td>
                  <td>
                    <span className="activity__desc">{r.description}</span>
                    {r.targetName && (
                      <em className="activity__target">
                        {r.targetType || 'record'}: {r.targetName}
                      </em>
                    )}
                    {r.ip && <em className="activity__ip">{r.ip}</em>}
                  </td>
                  <td>
                    <span className={`status ${r.status === 'failed' ? 'rejected' : 'approved'}`}>
                      {r.status === 'failed' ? 'Failed' : 'Success'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
