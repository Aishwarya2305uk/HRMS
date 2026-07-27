import { useMemo, useState } from 'react'
import { formatDate, formatHours } from '../lib/format'
import { EmptyState } from './States'

/**
 * Admin company-wide attendance view: every employee's daily worked hours
 * and present/leave verdict for the selected month.
 * @param {Array}  props.rows          from /attendance/all
 * @param {string} [props.searchQuery] filters rows by employee name
 */
export default function AllAttendance({ rows, searchQuery = '' }) {
  const [filter, setFilter] = useState('all')
  const rowsWithStatus = useMemo(() => rows.filter((r) => r.dayStatus), [rows])
  const filtered = useMemo(() => {
    const byStatus = filter === 'all' ? rowsWithStatus : rowsWithStatus.filter((r) => r.dayStatus === filter)
    const q = searchQuery.trim().toLowerCase()
    if (!q) return byStatus
    return byStatus.filter((r) => r.employeeName?.toLowerCase().includes(q))
  }, [rowsWithStatus, filter, searchQuery])
  const counts = useMemo(() => {
    const c = { all: rowsWithStatus.length, present: 0, leave: 0 }
    for (const r of rowsWithStatus) c[r.dayStatus]++
    return c
  }, [rowsWithStatus])

  return (
    <section className="card pop" style={{ '--d': '120ms' }}>
      <div className="attendance__head">
        <h2>All attendance</h2>
        <div className="seg">
          {['all', 'present', 'leave'].map((s) => (
            <button
              key={s}
              className={`seg__btn${filter === s ? ' is-active' : ''}`}
              onClick={() => setFilter(s)}
            >
              {s === 'leave' ? 'Auto-leave' : s[0].toUpperCase() + s.slice(1)} <b>{counts[s]}</b>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="clock"
          title={searchQuery.trim() ? 'No matches' : 'No attendance recorded yet'}
          message={
            searchQuery.trim()
              ? `Nobody named "${searchQuery.trim()}" has attendance this month.`
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
                  <td>{r.workedSeconds ? formatHours(r.workedSeconds) : '—'}</td>
                  <td>
                    <span className={`status ${r.dayStatus === 'leave' ? 'auto-leave' : 'present'}`}>
                      {r.dayStatus === 'leave' ? 'Auto-leave (<8h)' : 'Present'}
                    </span>
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
