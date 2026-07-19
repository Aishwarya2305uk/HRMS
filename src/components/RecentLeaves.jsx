import Icon from './Icon'
import { tactile } from '../lib/haptics'
import { formatRange } from '../lib/format'

/**
 * The current user's recent leave applications with live status.
 * @param {Array}  props.leaves      from /leaves/mine
 * @param {object} props.typeLabels  { key: label }
 * @param {number} [props.limit]     rows to show (default all)
 */
export default function RecentLeaves({ leaves, typeLabels, limit }) {
  const rows = limit ? leaves.slice(0, limit) : leaves

  return (
    <section className="card requests pop" style={{ '--d': '440ms' }}>
      <div className="attendance__head">
        <h2>My leave requests</h2>
      </div>

      {rows.length === 0 ? (
        <p className="empty">No leave requests yet. Apply for leave to see it here.</p>
      ) : (
        <ul className="req-list">
          {rows.map((l) => (
            <li key={l.id} className="req" tabIndex={0} {...tactile('light')}>
              <span className="req__type">
                <Icon name="leaf" size={16} />
                <span>
                  <strong>{typeLabels[l.type] ?? l.type}</strong>
                  <em>
                    {formatRange(l.startDate, l.endDate)} · {l.days} {l.days > 1 ? 'days' : 'day'}
                    {l.status === 'rejected' && l.decisionComment ? ` · “${l.decisionComment}”` : ''}
                  </em>
                </span>
              </span>
              <span className={`status ${l.status}`}>{l.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
