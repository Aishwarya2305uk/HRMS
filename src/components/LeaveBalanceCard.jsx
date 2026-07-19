import Icon from './Icon'
import { tactile } from '../lib/haptics'
import { Skeleton } from './States'

const TINTS = { casual: 'blue', sick: 'green', earned: 'indigo' }

/**
 * Leave balance summary: a ring for the total remaining plus a per-type legend.
 * Types/quotas come from the server config so this never drifts from policy.
 *
 * When a type is fully used we say so explicitly rather than showing a bare 0 —
 * "0 left" is easy to misread as "not loaded".
 */
export default function LeaveBalanceCard({ user, types, onApply, loading, canApply = true }) {
  const balances = user?.leaveBalances ?? {}
  const quotaTotal = user?.leaveQuotaTotal ?? types.reduce((s, t) => s + t.quota, 0)
  const remaining = types.reduce((s, t) => s + (Number(balances[t.key]) || 0), 0)
  const pct = quotaTotal ? Math.min(100, (remaining / quotaTotal) * 100) : 0
  const noneLeft = types.length > 0 && remaining === 0

  return (
    <section className="card leave-balance pop" style={{ '--d': '370ms' }}>
      <div className="attendance__head">
        <h2>Leave balance</h2>
      </div>

      {loading ? (
        <Skeleton rows={2} />
      ) : (
        <>
          <div className="ring-wrap">
            <div className="ring" style={{ '--pct': `${pct}%` }}>
              <div className="ring__center">
                <strong>{remaining}</strong>
                <span>of {quotaTotal} days</span>
              </div>
            </div>
            <ul className="leave-legend">
              {types.map((t) => {
                const left = Number(balances[t.key]) || 0
                return (
                  <li key={t.key}>
                    <span className={`lg ${TINTS[t.key] || 'indigo'}`} /> {t.label}
                    <b className={left === 0 ? 'is-spent' : undefined}>
                      {left === 0 ? 'none left' : left}
                    </b>
                  </li>
                )
              })}
            </ul>
          </div>

          <button
            className="btn-tactile primary block"
            onClick={onApply}
            disabled={!canApply || noneLeft}
            {...tactile('medium')}
          >
            <Icon name="plus" size={18} />
            Apply for leave
          </button>

          {/* Explain *why* the button is disabled — a dead control with no
              explanation is one of the most common UX failures. */}
          {!canApply && (
            <p className="field-hint">Leave types couldn&apos;t load. Try refreshing the page.</p>
          )}
          {canApply && noneLeft && (
            <p className="field-hint">You&apos;ve used all your leave for this year.</p>
          )}
        </>
      )}
    </section>
  )
}
