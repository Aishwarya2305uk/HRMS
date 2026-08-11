import { useMemo, useState } from 'react'
import { formatDate, formatTime, formatHours } from '../lib/format'
import { leaves as leavesApi } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { EmptyState, InlineError } from './States'

/**
 * The user's own attendance history table (server-computed).
 *
 * Days that fell short of 8 hours ("Leave" verdict — e.g. an accidental early
 * check-out) carry a "Request fix" action: an inline reason + submit that
 * asks the manager to count the day as present (kind 'regularize' — approval
 * flips the day's verdict server-side and it shows here as Present).
 *
 * @param {Array}    props.rows          from /attendance/history (toLiveJSON shape)
 * @param {Array}    [props.regularize]  the user's own kind:'regularize' requests
 * @param {Function} [props.onRegularized] (createdRequest) => void
 */
export default function AttendanceHistory({ rows, regularize = [], onRegularized }) {
  const [requestingDate, setRequestingDate] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState({ date: null, message: '' })

  // Latest word per day: an open (pending/approved) request locks the action;
  // a rejection leaves the button available to try again.
  const fixByDate = useMemo(() => {
    const byDate = {}
    for (const r of regularize) {
      const key = String(r.startDate).slice(0, 10)
      if (byDate[key] === 'pending' || byDate[key] === 'approved') continue
      byDate[key] = r.status
    }
    return byDate
  }, [regularize])

  async function submit(date) {
    const trimmed = reason.trim()
    if (!trimmed) {
      setRowError({ date, message: 'Please add a short reason — your manager sees it.' })
      return
    }
    setBusy(true)
    setRowError({ date: null, message: '' })
    try {
      const created = await leavesApi.regularize({ date, reason: trimmed })
      haptic('success')
      setRequestingDate(null)
      setReason('')
      onRegularized?.(created)
    } catch (err) {
      setRowError({ date, message: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card pop" style={{ '--d': '120ms' }}>
      <div className="attendance__head">
        <h2>Attendance history</h2>
        <span className="count-pill">{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No attendance yet"
          message="Once you check in, each day appears here with your hours and status."
        />
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
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = r.status === 'active'
                const short = !open && r.dayStatus !== 'present'
                const label = open ? 'In progress' : short ? 'Leave' : 'Present'
                const cls = open ? 'pending' : short ? 'rejected' : 'approved'
                const fix = fixByDate[r.date]
                const requesting = requestingDate === r.date
                return (
                  <tr key={r.date}>
                    <td>{formatDate(r.date, true)}</td>
                    <td>{formatTime(r.checkInAt)}</td>
                    <td>{open ? '—' : formatTime(r.checkOutAt)}</td>
                    <td>{formatHours(r.workedSeconds)}</td>
                    <td><span className={`status ${cls}`}>{label}</span></td>
                    <td>
                      {!short ? (
                        '—'
                      ) : fix === 'pending' ? (
                        <span className="status pending">Fix requested</span>
                      ) : requesting ? (
                        <span className="req__confirm">
                          <input
                            type="text"
                            placeholder="What happened? (required)"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            aria-label={`Reason for counting ${formatDate(r.date, true)} as present`}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="btn-tactile primary sm"
                            disabled={busy}
                            onClick={() => submit(r.date)}
                          >
                            {busy ? 'Sending…' : 'Send'}
                          </button>
                          <button
                            type="button"
                            className="btn-tactile ghost sm"
                            disabled={busy}
                            onClick={() => { setRequestingDate(null); setReason(''); setRowError({ date: null, message: '' }) }}
                          >
                            Cancel
                          </button>
                          {rowError.date === r.date && <InlineError>{rowError.message}</InlineError>}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => { haptic('light'); setReason(''); setRequestingDate(r.date) }}
                        >
                          Request fix
                        </button>
                      )}
                    </td>
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
