import { formatDate, formatTime, formatHours } from '../lib/format'

/**
 * The user's own attendance history table (server-computed).
 * @param {Array} props.rows  from /attendance/history (toLiveJSON shape)
 */
export default function AttendanceHistory({ rows }) {
  return (
    <section className="card pop" style={{ '--d': '120ms' }}>
      <div className="attendance__head">
        <h2>Attendance history</h2>
        <span className="count-pill">{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <p className="empty">No attendance recorded yet. Check in from your dashboard.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Check in</th>
                <th>Check out</th>
                <th>Worked</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = r.status === 'active'
                const label = open ? 'In progress' : r.dayStatus === 'present' ? 'Present' : 'Leave'
                const cls = open ? 'pending' : r.dayStatus === 'present' ? 'approved' : 'rejected'
                return (
                  <tr key={r.date}>
                    <td>{formatDate(r.date, true)}</td>
                    <td>{formatTime(r.checkInAt)}</td>
                    <td>{open ? '—' : formatTime(r.checkOutAt)}</td>
                    <td>{formatHours(r.workedSeconds)}</td>
                    <td><span className={`status ${cls}`}>{label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
