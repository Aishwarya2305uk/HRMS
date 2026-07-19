import Icon from './Icon'
import { tactile } from '../lib/haptics'

const TINTS = { casual: 'blue', sick: 'green', earned: 'indigo' }

/**
 * Leave balance summary: a ring for the total remaining plus a per-type legend.
 * Types/quotas come from the server config so this never drifts from policy.
 *
 * @param {object}   props.user      current user (carries leaveBalances)
 * @param {Array}    props.types     [{ key, label, quota }] from /leaves/config
 * @param {()=>void} props.onApply   open the apply-leave modal
 */
export default function LeaveBalanceCard({ user, types, onApply }) {
  const balances = user?.leaveBalances ?? {}
  const quotaTotal = user?.leaveQuotaTotal ?? types.reduce((s, t) => s + t.quota, 0)
  const remaining = types.reduce((s, t) => s + (Number(balances[t.key]) || 0), 0)
  const pct = quotaTotal ? Math.min(100, (remaining / quotaTotal) * 100) : 0

  return (
    <section className="card leave-balance pop" style={{ '--d': '370ms' }}>
      <div className="attendance__head">
        <h2>Leave balance</h2>
      </div>

      <div className="ring-wrap">
        <div className="ring" style={{ '--pct': `${pct}%` }}>
          <div className="ring__center">
            <strong>{remaining}</strong>
            <span>of {quotaTotal} days</span>
          </div>
        </div>
        <ul className="leave-legend">
          {types.map((t) => (
            <li key={t.key}>
              <span className={`lg ${TINTS[t.key] || 'indigo'}`} /> {t.label}
              <b>{Number(balances[t.key]) || 0}</b>
            </li>
          ))}
        </ul>
      </div>

      <button className="btn-tactile primary block" onClick={onApply} {...tactile('medium')}>
        <Icon name="plus" size={18} />
        Apply for leave
      </button>
    </section>
  )
}
