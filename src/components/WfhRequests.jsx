import { useState } from 'react'
import Icon from './Icon'
import { leaves as leavesApi } from '../lib/hrms'
import { tactile, haptic } from '../lib/haptics'
import { formatRange, formatDate } from '../lib/format'
import { Skeleton, EmptyState, InlineError } from './States'

/** Plain-language explanation of what each status means for the user. */
const STATUS_HINT = {
  pending: 'Waiting on your manager',
  approved: 'Approved',
  rejected: 'Not approved',
}

/**
 * The current user's work-from-home requests with live status — same shape
 * and interactions as RecentLeaves (cancel while pending, rejection reason
 * surfaced), just for `kind: 'wfh'` entries, which never touch leave balance
 * and always carry a reason (required at apply time, so always shown here).
 */
export default function WfhRequests({
  requests,
  loading,
  error,
  onRetry,
  onApply,
  onCancel,
}) {
  const [confirmingId, setConfirmingId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [rowError, setRowError] = useState({ id: null, message: '' })

  async function confirmCancel(request) {
    setBusyId(request.id)
    setRowError({ id: null, message: '' })
    try {
      await leavesApi.cancel(request.id)
      haptic('light')
      setConfirmingId(null)
      onCancel?.(request.id)
    } catch (err) {
      setRowError({ id: request.id, message: err.message })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="card requests pop" style={{ '--d': '500ms' }}>
      <div className="attendance__head">
        <h2>Work from home</h2>
        <div className="attendance__head-actions">
          {!loading && !error && requests.length > 0 && (
            <span className="count-pill">{requests.length}</span>
          )}
          <button
            type="button"
            className="btn-tactile primary sm"
            onClick={() => { haptic('light'); onApply() }}
          >
            <Icon name="plus" size={15} />
            Request WFH
          </button>
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
          message="Request a work-from-home day using the button above — your manager will be notified."
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
                      <em>
                        {formatRange(r.startDate, r.endDate)} · {r.days}{' '}
                        {r.days > 1 ? 'days' : 'day'}
                      </em>
                    </span>
                  </span>
                  <span className={`status ${r.status}`} title={STATUS_HINT[r.status]}>
                    {r.status}
                  </span>
                </div>

                {r.reason && <p className="req__reason">“{r.reason}”</p>}

                {/* Rejections without a reason feel arbitrary — surface it. */}
                {r.status === 'rejected' && r.decisionComment && (
                  <p className="req__note">Reason: {r.decisionComment}</p>
                )}

                {rowError.id === r.id && <InlineError>{rowError.message}</InlineError>}

                <div className="req__meta">
                  <span className="req__applied">Applied {formatDate(r.createdAt)}</span>

                  {r.status === 'pending' &&
                    (confirming ? (
                      <span className="req__confirm">
                        <span>Cancel this request?</span>
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
                          onClick={() => setConfirmingId(null)}
                        >
                          Keep it
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="req__cancel"
                        onClick={() => setConfirmingId(r.id)}
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
