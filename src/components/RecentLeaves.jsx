import { useState } from 'react'
import Icon from './Icon'
import { leaves as leavesApi } from '../lib/hrms'
import { tactile, haptic } from '../lib/haptics'
import { formatRequestWindow, formatDate } from '../lib/format'
import { Skeleton, EmptyState, InlineError } from './States'

/** Plain-language explanation of what each status means for the user. */
const STATUS_HINT = {
  pending: 'Waiting on your manager',
  approved: 'Approved — balance deducted',
  rejected: 'Not approved',
  cancelled: 'Cancelled by you — balance returned',
}

/** Approved requests stay cancellable until the day they start. */
const canCancelApproved = (l) => l.status === 'approved' && new Date(l.startDate) > new Date()

/**
 * The current user's recent leave applications with live status.
 * Handles its own loading / error / empty presentation so the caller doesn't
 * have to duplicate that logic.
 *
 * Cancelling is inline, in place (no confirm() dialog or modal) — the row
 * itself carries the whole interaction. A pending request cancels for free
 * (balance is only deducted on approval) and disappears; an APPROVED one can
 * be cancelled any time before its start date, with an optional reason — the
 * server flips it to 'cancelled' and refunds the balance (see onCancel).
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
  title = 'My leave requests',
  plain = false,
}) {
  const rows = limit ? leaves.slice(0, limit) : leaves
  const [confirmingId, setConfirmingId] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [rowError, setRowError] = useState({ id: null, message: '' })

  async function confirmCancel(leave) {
    setBusyId(leave.id)
    setRowError({ id: null, message: '' })
    try {
      const result = await leavesApi.cancel(
        leave.id,
        leave.status === 'approved' ? cancelReason.trim() : undefined,
      )
      haptic('light')
      setConfirmingId(null)
      setCancelReason('')
      onCancel?.(result)
    } catch (err) {
      setRowError({ id: leave.id, message: err.message })
    } finally {
      setBusyId(null)
    }
  }

  // `plain` drops the card chrome so this can sit as one section inside a
  // larger card (the Leaves tab's split "history" card).
  const Root = plain ? 'div' : 'section'
  return (
    <Root
      className={plain ? 'requests' : 'card requests pop'}
      style={plain ? undefined : { '--d': '440ms' }}
    >
      <div className="attendance__head">
        <h2>{title}</h2>
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
                      <em>{formatRequestWindow(l)}</em>
                    </span>
                  </span>
                  <span className={`status ${l.status}`} title={STATUS_HINT[l.status]}>
                    {l.status}
                  </span>
                </div>

                {(l.employeeId || l.employeeEmail) && (
                  <p className="req__ident">
                    {[l.employeeId, l.employeeEmail].filter(Boolean).join(' · ')}
                  </p>
                )}

                {/* Rejections without a reason feel arbitrary — surface it. */}
                {l.status === 'rejected' && l.decisionComment && (
                  <p className="req__note">Reason: {l.decisionComment}</p>
                )}
                {l.status === 'cancelled' && l.cancelReason && (
                  <p className="req__note">Cancelled: {l.cancelReason}</p>
                )}

                {rowError.id === l.id && <InlineError>{rowError.message}</InlineError>}

                <div className="req__meta">
                  <span className="req__applied">Applied {formatDate(l.createdAt)}</span>

                  {(l.status === 'pending' || canCancelApproved(l)) &&
                    (confirming ? (
                      <span className="req__confirm">
                        {l.status === 'approved' ? (
                          <input
                            type="text"
                            placeholder="Reason (optional)"
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            aria-label="Reason for cancelling this approved leave (optional)"
                            autoFocus
                          />
                        ) : (
                          <span>Cancel this request?</span>
                        )}
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
                          onClick={() => { setConfirmingId(null); setCancelReason('') }}
                        >
                          Keep it
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="req__cancel"
                        onClick={() => { setCancelReason(''); setConfirmingId(l.id) }}
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
    </Root>
  )
}
