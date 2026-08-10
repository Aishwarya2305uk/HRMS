import Icon from './Icon'
import { formatRequestWindow } from '../lib/format'
import { EmptyState } from './States'

/** Days until the leave begins, in words. */
function startsIn(startDate) {
  const days = Math.ceil((new Date(startDate) - Date.now()) / 86400000)
  if (days <= 0) return 'Starts today'
  if (days === 1) return 'Starts tomorrow'
  return `Starts in ${days} days`
}

/**
 * The Leaves tab's "Upcoming leaves" card: approved leave and WFH days that
 * haven't started yet, soonest first. Read-only — cancelling lives with the
 * request history below it, which offers Cancel on these same rows.
 */
export default function UpcomingLeaves({ upcoming, typeLabels }) {
  return (
    <section className="card pop" style={{ '--d': '440ms' }}>
      <div className="attendance__head">
        <h2>Upcoming leaves</h2>
        {upcoming.length > 0 && <span className="count-pill">{upcoming.length}</span>}
      </div>

      {upcoming.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Nothing coming up"
          message="Approved leave and work-from-home days that haven't started yet will show up here."
        />
      ) : (
        <ul className="req-list">
          {upcoming.map((l) => (
            <li key={l.id} className="req">
              <div className="req__row">
                <span className="req__type">
                  <Icon name={l.kind === 'wfh' ? 'home' : 'leaf'} size={16} />
                  <span>
                    <strong>{l.kind === 'wfh' ? 'Work from home' : typeLabels[l.type] ?? l.type}</strong>
                    <em>{formatRequestWindow(l)}</em>
                  </span>
                </span>
                <span className="status approved">{startsIn(l.startDate)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
