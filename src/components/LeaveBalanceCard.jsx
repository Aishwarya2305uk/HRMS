import Icon from './Icon'
import { tactile } from '../lib/haptics'
import { Skeleton } from './States'

const TINTS = { casual: 'blue', sick: 'green', earned: 'indigo' }
/** Cycled by index for any type key not in the map above — e.g. a custom
 *  leave type an admin added (see components/LeaveTypesManager.jsx). */
const TINT_PALETTE = ['blue', 'green', 'indigo', 'amber']
const tintFor = (key, index) => TINTS[key] || TINT_PALETTE[index % TINT_PALETTE.length]

/**
 * Leave balance summary: a ring for the total remaining plus a per-type legend.
 * Types come from the server config (admin-managed — see LeaveTypesManager);
 * quotas are per-user, from their assigned employment type's policy.
 *
 * When a type is fully used we say so explicitly rather than showing a bare 0 —
 * "0 left" is easy to misread as "not loaded".
 */
export default function LeaveBalanceCard({ user, types, onApply, loading, canApply = true, plain = false }) {
  const balances = user?.leaveBalances ?? {}
  const remaining = types.reduce((s, t) => s + (Number(balances[t.key]) || 0), 0)
  // The quota snapshot can be missing (accounts created before an employment
  // type / policy was assigned) — never let the ring read "29 of 0 days"
  // with an empty arc; fall back to the remaining total as the denominator.
  const quotaTotal = Math.max(user?.leaveQuotaTotal ?? 0, remaining)
  const pct = quotaTotal ? Math.min(100, (remaining / quotaTotal) * 100) : 0
  const noneLeft = types.length > 0 && remaining === 0
  // Zero remaining AND zero granted means leave was never allocated — a very
  // different situation from having spent a real quota.
  const neverGranted = noneLeft && quotaTotal === 0

  // `plain` drops the card chrome so this can sit as one section inside a
  // larger card (the Leaves tab's split "apply" card) — the parent then owns
  // padding, border and the entrance animation.
  const Root = plain ? 'div' : 'section'
  return (
    <Root
      className={plain ? 'leave-balance' : 'card leave-balance pop'}
      style={plain ? undefined : { '--d': '370ms' }}
    >
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
              {types.map((t, i) => {
                const left = Number(balances[t.key]) || 0
                return (
                  <li key={t.key}>
                    <span className={`lg ${tintFor(t.key, i)}`} /> {t.label}
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
            <p className="field-hint">
              {neverGranted
                ? 'No leave has been allocated to your account yet — please contact your admin.'
                : 'You’ve used all your leave for this year.'}
            </p>
          )}
        </>
      )}
    </Root>
  )
}
