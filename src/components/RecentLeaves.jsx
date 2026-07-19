import Icon from './Icon'
import { tactile } from '../lib/haptics'
import { formatRange } from '../lib/format'
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
 */
export default function RecentLeaves({
  leaves,
  typeLabels,
  limit,
  loading,
  error,
  onRetry,
  onApply,
}) {
  const rows = limit ? leaves.slice(0, limit) : leaves

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
          {rows.map((l) => (
            <li key={l.id} className="req" tabIndex={0} {...tactile('light')}>
              <span className="req__type">
                <Icon name="leaf" size={16} />
                <span>
                  <strong>{typeLabels[l.type] ?? l.type}</strong>
                  <em>
                    {formatRange(l.startDate, l.endDate)} · {l.days}{' '}
                    {l.days > 1 ? 'days' : 'day'}
                  </em>
                  {/* Rejections without a reason feel arbitrary — surface it. */}
                  {l.status === 'rejected' && l.decisionComment && (
                    <em className="req__note">Reason: {l.decisionComment}</em>
                  )}
                </span>
              </span>
              <span className={`status ${l.status}`} title={STATUS_HINT[l.status]}>
                {l.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
