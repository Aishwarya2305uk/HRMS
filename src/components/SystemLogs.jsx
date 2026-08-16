import { useCallback, useEffect, useRef, useState } from 'react'
import { systemLogs } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { useSessionState } from '../lib/useSessionState'
import Icon from './Icon'
import { Skeleton, ErrorState, EmptyState, InlineError } from './States'

/** dd/mm/yyyy, hh:mm:ss — dense and column-aligned, like a server log. */
function formatTs(ts) {
  return new Date(ts).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
}

// [value, label] pairs; 'all' (or the 30d default for dates) sends no param.
const ROLE_OPTIONS = [
  ['all', 'Role: All'],
  ['admin', 'Admin'],
  ['manager', 'Manager'],
  ['employee', 'Employee'],
  ['anonymous', 'Anonymous'],
]
const LEVEL_OPTIONS = [
  ['all', 'Level: All'],
  ['ok', 'Success'],
  ['client', 'Client errors (4xx)'],
  ['server', 'Server errors (5xx)'],
]
const METHOD_OPTIONS = [
  ['all', 'Method: All'],
  ['GET', 'GET'],
  ['POST', 'POST'],
  ['PATCH', 'PATCH'],
  ['DELETE', 'DELETE'],
]
const DATE_OPTIONS = [
  ['30', 'Date: All (30d kept)'],
  ['7', 'Last 7 days'],
  ['1', 'Last 24 hours'],
]

/**
 * Admin System Logs: one table row per API call, newest first, with the
 * failure reason on every unsuccessful one. Self-contained (owns its fetch
 * state rather than using useAsyncData) because the filter set drives the
 * query and search needs a debounce.
 */
export default function SystemLogs() {
  // The filter set survives a refresh (per tab) so the admin lands back on
  // the same slice of the log.
  const [search, setSearch] = useSessionState('ui.systemLogs.search', '')
  const [roleFilter, setRoleFilter] = useSessionState('ui.systemLogs.role', 'all')
  const [level, setLevel] = useSessionState('ui.systemLogs.level', 'all')
  const [method, setMethod] = useSessionState('ui.systemLogs.method', 'all')
  const [days, setDays] = useSessionState('ui.systemLogs.days', '30')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  // Guards a slow earlier response from overwriting a newer one — same trick
  // as useAsyncData's runId.
  const runRef = useRef(0)

  const load = useCallback(async (filters) => {
    const runId = ++runRef.current
    setLoading(true)
    setError(null)
    try {
      const data = await systemLogs.list(filters)
      if (runId !== runRef.current) return
      setRows(data)
    } catch (err) {
      if (runId === runRef.current) setError(err)
    } finally {
      if (runId === runRef.current) setLoading(false)
    }
  }, [])

  // One effect covers first load and every filter change; typing debounces
  // (select changes ride the same barely-noticeable delay while text is set).
  useEffect(() => {
    const timer = setTimeout(
      () => load({ search: search.trim(), role: roleFilter, level, method, days }),
      search ? 300 : 0,
    )
    return () => clearTimeout(timer)
  }, [search, roleFilter, level, method, days, load])

  function refresh() {
    haptic('light')
    load({ search: search.trim(), role: roleFilter, level, method, days })
  }

  const problems = (rows ?? []).filter((r) => r.status >= 400).length
  const filtersActive =
    Boolean(search.trim()) ||
    roleFilter !== 'all' ||
    level !== 'all' ||
    method !== 'all' ||
    days !== '30'

  const selects = [
    ['Filter by role', roleFilter, setRoleFilter, ROLE_OPTIONS],
    ['Filter by level', level, setLevel, LEVEL_OPTIONS],
    ['Filter by method', method, setMethod, METHOD_OPTIONS],
    ['Filter by date range', days, setDays, DATE_OPTIONS],
  ]

  return (
    <section className="card pop" style={{ '--d': '120ms' }}>
      <div className="syslog__head">
        <div>
          <h2>System Logs</h2>
          <p className="syslog__sub">
            Every API call — success, failure and crash — kept in our own database for 30
            days, so nothing is lost on redeploy. Form values, documents, query strings and
            tokens are never recorded.
          </p>
        </div>
        <button type="button" className="btn-tactile ghost sm syslog__refresh" onClick={refresh} disabled={loading}>
          <Icon name="refreshCw" size={14} />
          {loading && rows !== null ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="syslog__filters">
        <input
          className="syslog__search"
          type="search"
          placeholder="Search by user email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search logs by user email"
        />
        {selects.map(([label, value, set, options]) => (
          <select
            key={label}
            className="mini-select"
            value={value}
            onChange={(e) => set(e.target.value)}
            aria-label={label}
          >
            {options.map(([v, text]) => (
              <option key={v} value={v}>{text}</option>
            ))}
          </select>
        ))}
        {rows !== null && (
          <span className="syslog__count" role="status">
            {rows.length} rows
            {problems > 0 && <> · <b>{problems} problems</b></>}
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
          title={filtersActive ? 'No matches' : 'No requests recorded yet'}
          message={
            filtersActive
              ? 'Nothing in the log matches these filters.'
              : 'API activity will appear here as people use the app.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table syslog__table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Request</th>
                <th>Status</th>
                <th>Time</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="syslog__ts">{formatTs(r.ts)}</td>
                  <td>
                    {r.userEmail ? (
                      <div className="syslog__user">
                        <strong>{r.userEmail}</strong>
                        <em>{r.userRole}</em>
                      </div>
                    ) : (
                      <span className="syslog__anon">— anonymous —</span>
                    )}
                  </td>
                  <td>
                    <code className="syslog__req">{r.method} {r.path}</code>
                  </td>
                  <td>
                    <span
                      className={`syslog-code ${
                        r.status >= 500 ? 'is-danger' : r.status >= 400 ? 'is-warn' : 'is-ok'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="syslog__ms">{r.durationMs != null ? `${r.durationMs}ms` : '—'}</td>
                  <td>
                    {r.status >= 400 ? (
                      <span className="syslog__err">
                        <b>{r.errorCode}</b>
                        {r.errorMessage ? ` · ${r.errorMessage}` : ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
