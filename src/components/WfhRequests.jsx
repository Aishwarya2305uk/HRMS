import { useState } from 'react'
import Icon from './Icon'
import { leaves as leavesApi } from '../lib/hrms'
import { tactile, haptic } from '../lib/haptics'
import { formatRequestWindow, formatDate } from '../lib/format'
import { Skeleton, EmptyState, InlineError } from './States'

/** Plain-language explanation of what each status means for the user. */
const STATUS_HINT = {
  pending: 'Waiting on your manager',
  approved: 'Approved',
  rejected: 'Not approved',
  cancelled: 'Cancelled by you',
}

/** Approved requests stay cancellable until the day they start. */
const canCancelApproved = (r) => r.status === 'approved' && new Date(r.startDate) > new Date()

/**
 * The current user's work-from-home requests with live status — same shape
 * and interactions as RecentLeaves (cancel while pending or before an
 * approved one starts, rejection reason surfaced), just for `kind: 'wfh'`
 * entries, which never touch leave balance and always carry a reason
 * (required at apply time, so always shown here).
 */
export default function WfhRequests({
  requests,
  loading,
  error,
  onRetry,
  onApply,
  onCancel,
  title = 'Work from home',
  showApply = true,
  plain = false,
}) {
  const [confirmingId, setConfirmingId] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [rowError, setRowError] = useState({ id: null, message: '' })

  async function confirmCancel(request) {
    setBusyId(request.id)
    setRowError({ id: null, message: '' })
    try {
      const result = await leavesApi.cancel(
        request.id,
        request.status === 'approved' ? cancelReason.trim() : undefined,
      )
      haptic('light')
      setConfirmingId(null)
      setCancelReason('')
      onCancel?.(result)
    } catch (err) {
      setRowError({ id: request.id, message: err.message })
    } finally {
      setBusyId(null)
    }
  }

  // `plain` drops the card chrome so this can sit as one section inside a
  // larger card; `showApply={false}` hides the header button for history-only
  // views where applying lives elsewhere (the empty state still offers it).
  const Root = plain ? 'div' : 'section'
  return (
    <Root
      className={plain ? 'requests' : 'card requests pop'}
      style={plain ? undefined : { '--d': '500ms' }}
    >
      <div className="attendance__head">
        <h2>{title}</h2>
        <div className="attendance__head-actions">
          {!loading && !error && requests.length > 0 && (
            <span className="count-pill">{requests.length}</span>
          )}
          {showApply && (
            <button
              type="button"
              className="btn-tactile primary sm"
              onClick={() => { haptic('light'); onApply() }}
            >
              <Icon name="plus" size={15} />
              Request WFH
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <Skeleton rows={2} />
      ) : error ? (
        <InlineError onRetry={onRetry}>{error.message}</InlineError>
      ) : requests.length === 0 ? (
        <EmptyState
          icon="home"
          title="No WFH requests yet"
          message="Request a work-from-home day — your manager will be notified."
          action={!showApply && onApply ? { label: 'Request WFH', onClick: onApply } : undefined}
        />
      ) : (
        <ul className="req-list">
          {requests.map((r) => {
            const busy = busyId === r.id
            const confirming = confirmingId === r.id
            return (
              <li key={r.id} className="req" tabIndex={0} {...tactile('light')}>
                <div className="req__row">
                  <span className="req__type">
                    <Icon name="home" size={16} />
                    <span>
                      <strong>Work from home</strong>
                      <em>{formatRequestWindow(r)}</em>
                    </span>
                  </span>
                  <span className={`status ${r.status}`} title={STATUS_HINT[r.status]}>
                    {r.status}
                  </span>
                </div>

                {(r.employeeId || r.employeeEmail) && (
                  <p className="req__ident">
                    {[r.employeeId, r.employeeEmail].filter(Boolean).join(' · ')}
                  </p>
                )}

                {r.reason && <p className="req__reason">“{r.reason}”</p>}

                {/* Rejections without a reason feel arbitrary — surface it. */}
                {r.status === 'rejected' && r.decisionComment && (
                  <p className="req__note">Reason: {r.decisionComment}</p>
                )}
                {r.status === 'cancelled' && r.cancelReason && (
                  <p className="req__note">Cancelled: {r.cancelReason}</p>
                )}

                {rowError.id === r.id && <InlineError>{rowError.message}</InlineError>}

                <div className="req__meta">
                  <span className="req__applied">Applied {formatDate(r.createdAt)}</span>

                  {(r.status === 'pending' || canCancelApproved(r)) &&
                    (confirming ? (
                      <span className="req__confirm">
                        {r.status === 'approved' ? (
                          <input
                            type="text"
                            placeholder="Reason (optional)"
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            aria-label="Reason for cancelling this approved request (optional)"
                            autoFocus
                          />
                        ) : (
                          <span>Cancel this request?</span>
                        )}
                        <button
                          type="button"
                          className="btn-tactile danger sm"
                          disabled={busy}
                          onClick={() => confirmCancel(r)}
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
                        onClick={() => { setCancelReason(''); setConfirmingId(r.id) }}
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
