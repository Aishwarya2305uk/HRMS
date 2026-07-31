import Icon from './Icon'
import { haptic, tactile } from '../lib/haptics'

/**
 * The "request work from home" half of the Leaves tab's apply card — the WFH
 * counterpart to LeaveBalanceCard's apply section. Rendered inside the shared
 * .leaves-duo card, so it carries no card chrome of its own. WFH days never
 * deduct from leave balance, so unlike its neighbour there's no quota to show
 * — just the pitch and the button, plus a pending count when there is one.
 */
export default function WfhApplyCard({ onApply, pendingCount = 0 }) {
  return (
    <div className="wfh-apply">
      <div className="attendance__head">
        <h2>Work from home</h2>
        {pendingCount > 0 && (
          <span className="count-pill">{pendingCount} pending</span>
        )}
      </div>

      <div className="wfh-apply__body">
        <span className="wfh-apply__icon">
          <Icon name="home" size={22} />
        </span>
        <p>
          Planning to work remotely? Send a request for the days you need —
          your manager is notified right away, and approved WFH days never
          touch your leave balance.
        </p>
      </div>

      <button
        className="btn-tactile primary block"
        onClick={() => { haptic('medium'); onApply() }}
        {...tactile('medium')}
      >
        <Icon name="plus" size={18} />
        Request work from home
      </button>
    </div>
  )
}
