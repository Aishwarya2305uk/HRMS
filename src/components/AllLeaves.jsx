import { useMemo, useState } from 'react'
import { formatRange, formatDate } from '../lib/format'
import { EmptyState } from './States'

/**
 * Admin company-wide leave view: every application with employee, dates and
 * status, filterable by status.
 * @param {Array}  props.leaves      from /leaves/all
 * @param {object} props.typeLabels  { key: label }
 * @param {string} [props.searchQuery]  filters rows by employee name
 */
export default function AllLeaves({ leaves, typeLabels, searchQuery = '' }) {
  const [filter, setFilter] = useState('all')
  const rows = useMemo(() => {
    const byStatus = filter === 'all' ? leaves : leaves.filter((l) => l.status === filter)
    const q = searchQuery.trim().toLowerCase()
    if (!q) return byStatus
    return byStatus.filter((l) => l.employeeName?.toLowerCase().includes(q))
  }, [leaves, filter, searchQuery])
  const counts = useMemo(() => {
    const c = { all: leaves.length, pending: 0, approved: 0, rejected: 0 }
    for (const l of leaves) c[l.status]++
    return c
  }, [leaves])

  return (
    <section className="card pop" style={{ '--d': '120ms' }}>
      <div className="attendance__head">
        <h2>All leaves</h2>
        <div className="seg">
          {['all', 'pending', 'approved', 'rejected'].map((s) => (
            <button
              key={s}
              className={`seg__btn${filter === s ? ' is-active' : ''}`}
              onClick={() => setFilter(s)}
            >
              {s[0].toUpperCase() + s.slice(1)} <b>{counts[s]}</b>
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="calendarDays"
          title={searchQuery.trim() ? 'No matches' : filter === 'all' ? 'No leave requests yet' : `No ${filter} requests`}
          message={
            searchQuery.trim()
              ? `Nobody named "${searchQuery.trim()}" has ${filter === 'all' ? 'a request' : `a ${filter} request`}.`
              : filter === 'all'
                ? 'Company-wide leave applications will appear here.'
                : 'Try a different filter to see other requests.'
          }
          action={filter !== 'all' && !searchQuery.trim() ? { label: 'Show all', onClick: () => setFilter('all') } : undefined}
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>Dates</th>
                <th>Days</th>
                <th>Applied</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="cell-name">
                      <span className="avatar sm" aria-hidden="true">{l.employeeName?.[0] ?? '?'}</span>
                      <strong>{l.employeeName}</strong>
                    </div>
                  </td>
                  <td>{typeLabels[l.type] ?? l.type}</td>
                  <td>{formatRange(l.startDate, l.endDate)}</td>
                  <td>{l.days}</td>
                  <td>{formatDate(l.createdAt, true)}</td>
                  <td><span className={`status ${l.status}`}>{l.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
