import { useState } from 'react'
import Icon from './Icon'
import { leaves as leavesApi } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { formatRange } from '../lib/format'
import { Skeleton, EmptyState, InlineError } from './States'

/**
 * Manager approval queue — pending leaves from DIRECT REPORTS only (the server
 * enforces this; the UI just renders what it returns).
 *
 * UX notes:
 *  - Approve/reject are per-row, and only the row being acted on shows a busy
 *    state, so one slow request doesn't freeze the whole queue.
 *  - Rejecting asks for an optional reason first — a rejection with no
 *    explanation is a bad experience for the employee receiving it.
 *  - Errors appear next to the row that failed, not as a page-level banner.
 */
export default function Approvals({
  pending,
  typeLabels,
  onDecided,
  loading,
  error,
  onRetry,
}) {
  const [busyId, setBusyId] = useState(null)
  const [rowError, setRowError] = useState({ id: null, message: '' })
  const [rejecting, setRejecting] = useState(null)
  const [comment, setComment] = useState('')

  async function decide(leave, outcome) {
    setBusyId(leave.id)
    setRowError({ id: null, message: '' })
    haptic(outcome === 'approved' ? 'success' : 'warning')
    try {
      if (outcome === 'approved') await leavesApi.approve(leave.id)
      else await leavesApi.reject(leave.id, comment)
      setRejecting(null)
      setComment('')
      onDecided(leave.id, outcome, leave.employeeName)
    } catch (err) {
      setRowError({ id: leave.id, message: err.message })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="card approvals pop" style={{ '--d': '260ms' }}>
      <div className="attendance__head">
        <h2>Pending approvals</h2>
        {!loading && !error && <span className="count-pill">{pending.length}</span>}
      </div>

      {loading ? (
        <Skeleton rows={2} />
      ) : error ? (
        <InlineError onRetry={onRetry}>{error.message}</InlineError>
      ) : pending.length === 0 ? (
        <EmptyState
          icon="check"
          title="You're all caught up"
          message="No leave requests from your team are waiting for a decision."
        />
      ) : (
        <ul className="approval-list">
          {pending.map((l) => {
            const busy = busyId === l.id
            return (
              <li key={l.id} className="approval">
                <div className="approval__main">
                  <div className="approval__who">
                    <span className="avatar sm" aria-hidden="true">
                      {l.employeeName?.[0] ?? '?'}
                    </span>
                    <div>
                      <strong>{l.employeeName}</strong>
                      <em>
                        {typeLabels[l.type] ?? l.type} ·{' '}
                        {formatRange(l.startDate, l.endDate)} · {l.days}{' '}
                        {l.days > 1 ? 'days' : 'day'}
                      </em>
                    </div>
                  </div>
                  {l.reason && <p className="approval__reason">“{l.reason}”</p>}
                  {rowError.id === l.id && <InlineError>{rowError.message}</InlineError>}
                </div>

                {rejecting === l.id ? (
                  <div className="approval__reject">
                    <label className="sr-only" htmlFor={`reject-${l.id}`}>
                      Reason for rejecting {l.employeeName}&apos;s leave (optional)
                    </label>
                    <input
                      id={`reject-${l.id}`}
                      type="text"
                      placeholder="Reason (optional, but kinder)"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      autoFocus
                    />
                    <button
                      className="btn-tactile danger sm"
                      disabled={busy}
                      onClick={() => decide(l, 'rejected')}
                    >
                      {busy ? 'Rejecting…' : 'Confirm reject'}
                    </button>
                    <button
                      className="btn-tactile ghost sm"
                      disabled={busy}
                      onClick={() => { setRejecting(null); setComment('') }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="approval__actions">
                    <button
                      className="btn-tactile primary sm"
                      disabled={busy}
                      onClick={() => decide(l, 'approved')}
                    >
                      <Icon name="check" size={16} />
                      {busy ? 'Approving…' : 'Approve'}
                    </button>
                    <button
                      className="btn-tactile ghost sm"
                      disabled={busy}
                      onClick={() => setRejecting(l.id)}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
