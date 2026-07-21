import { useState } from 'react'
import Icon from './Icon'
import { leaves as leavesApi } from '../lib/hrms'
import { tactile, haptic } from '../lib/haptics'
import { formatRange, formatDate } from '../lib/format'
import { Skeleton, EmptyState, InlineError } from './States'

/** Plain-language explanation of what each status means for the user. */
const STATUS_HINT = {
  pending: 'Waiting on your manager',
  approved: 'Approved — balance deducted',
  rejected: 'Not approved',
}

/**
 * The current user's recent leave applications with live status.
 * Handles its own loading / error / empty presentation so the caller doesn't
 * have to duplicate that logic.
 *
 * A pending request can still be cancelled by its owner (no balance impact —
 * balance is only deducted on approval). Cancelling asks for confirmation
 * inline, in place, rather than a native confirm() dialog or a modal, so the
 * row itself carries the whole interaction.
 */
export default function RecentLeaves({
  leaves,
  typeLabels,
  limit,
  loading,
  error,
  onRetry,
  onApply,
  onCancel,
}) {
  const rows = limit ? leaves.slice(0, limit) : leaves
  const [confirmingId, setConfirmingId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [rowError, setRowError] = useState({ id: null, message: '' })

  async function confirmCancel(leave) {
    setBusyId(leave.id)
    setRowError({ id: null, message: '' })
    try {
      await leavesApi.cancel(leave.id)
      haptic('light')
      setConfirmingId(null)
      onCancel?.(leave.id)
    } catch (err) {
      setRowError({ id: leave.id, message: err.message })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="card requests pop" style={{ '--d': '440ms' }}>
      <div className="attendance__head">
        <h2>My leave requests</h2>
        {!loading && !error && leaves.length > 0 && (
          <span className="count-pill">{leaves.length}</span>
        )}
      </div>

      {loading ? (
        <Skeleton rows={3} />
      ) : error ? (
        <InlineError onRetry={onRetry}>{error.message}</InlineError>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="leaf"
          title="No leave requests yet"
          message="When you apply for leave, it'll show up here with its status."
          action={onApply ? { label: 'Apply for leave', onClick: onApply } : undefined}
        />
      ) : (
        <ul className="req-list">
          {rows.map((l) => {
            const busy = busyId === l.id
            const confirming = confirmingId === l.id
            return (
              <li key={l.id} className="req" tabIndex={0} {...tactile('light')}>
                <div className="req__row">
                  <span className="req__type">
                    <Icon name="leaf" size={16} />
                    <span>
                      <strong>{typeLabels[l.type] ?? l.type}</strong>
                      <em>
                        {formatRange(l.startDate, l.endDate)} · {l.days}{' '}
                        {l.days > 1 ? 'days' : 'day'}
                      </em>
                    </span>
                  </span>
                  <span className={`status ${l.status}`} title={STATUS_HINT[l.status]}>
                    {l.status}
                  </span>
                </div>

                {/* Rejections without a reason feel arbitrary — surface it. */}
                {l.status === 'rejected' && l.decisionComment && (
                  <p className="req__note">Reason: {l.decisionComment}</p>
                )}

                {rowError.id === l.id && <InlineError>{rowError.message}</InlineError>}

                <div className="req__meta">
                  <span className="req__applied">Applied {formatDate(l.createdAt)}</span>

                  {l.status === 'pending' &&
                    (confirming ? (
                      <span className="req__confirm">
                        <span>Cancel this request?</span>
                        <button
                          type="button"
                          className="btn-tactile danger sm"
                          disabled={busy}
                          onClick={() => confirmCancel(l)}
                        >
                          {busy ? 'Cancelling…' : 'Yes, cancel'}
                        </button>
                        <button
                          type="button"
                          className="btn-tactile ghost sm"
                          disabled={busy}
                          onClick={() => setConfirmingId(null)}
                        >
                          Keep it
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="req__cancel"
                        onClick={() => setConfirmingId(l.id)}
                      >
                        <Icon name="x" size={13} />
                        Cancel
                      </button>
                    ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
