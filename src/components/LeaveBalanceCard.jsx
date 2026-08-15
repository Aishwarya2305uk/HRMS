import Icon from './Icon'
import { tactile } from '../lib/haptics'
import { formatLeaveHoursOnly } from '../lib/format'
import { Skeleton } from './States'

const TINTS = { casual: 'blue', sick: 'green', earned: 'indigo' }
/** Cycled by index for any type key not in the map above — e.g. a custom
 *  leave type an admin added (see components/LeaveTypesManager.jsx). */
const TINT_PALETTE = ['blue', 'green', 'indigo', 'amber']
const tintFor = (key, index) => TINTS[key] || TINT_PALETTE[index % TINT_PALETTE.length]

/** Trim a day count for display: 12 -> "12", 0.25 -> "0.25", 0.1875 -> "0.19". */
const fmtDays = (v) => String(Math.round((Number(v) || 0) * 100) / 100)

/**
 * Leave balance summary: a ring for the total remaining plus two PARALLEL
 * per-type bar graphs of remaining vs granted — one scaled in days, one in
 * hours (8h = 1 day). Types come from the server config (admin-managed — see
 * LeaveTypesManager); balances/quotas are per-user, with day/month-period
 * types showing this period's remaining (annotated "/day", "/month").
 *
 * When a type is fully used we say so explicitly rather than showing a bare 0 —
 * "0 left" is easy to misread as "not loaded".
 */
export default function LeaveBalanceCard({ user, types, onApply, loading, canApply = true, plain = false }) {
  const balances = user?.leaveBalances ?? {}
  const quotas = user?.leaveQuotas ?? {}
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

  // One row per type, shared by both graphs: identical proportions, the days
  // panel and hours panel just read the same numbers in their own unit.
  const rows = types.map((t, i) => {
    const left = Number(balances[t.key]) || 0
    const quota = Math.max(Number(quotas[t.key]) || 0, left)
    return {
      key: t.key,
      label: t.label,
      period: t.period ?? 'year',
      left,
      quota,
      pct: quota ? Math.min(100, (left / quota) * 100) : 0,
      tint: tintFor(t.key, i),
    }
  })
  const PANELS = [
    { key: 'days', title: 'Days', value: (r) => `${fmtDays(r.left)} / ${fmtDays(r.quota)}` },
    {
      key: 'hours',
      title: 'Hours',
      value: (r) => `${formatLeaveHoursOnly(r.left)} / ${formatLeaveHoursOnly(r.quota)}`,
    },
  ]

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
            {/* Same remaining-vs-granted proportion twice, read in each unit —
                the days ring and the hours ring sit side by side. */}
            <div className="ring-duo">
              <figure className="ring-unit">
                <div className="ring" style={{ '--pct': `${pct}%` }}>
                  <div className="ring__center">
                    <strong>{fmtDays(remaining)}</strong>
                    <span>of {fmtDays(quotaTotal)} days</span>
                  </div>
                </div>
                <figcaption>Days</figcaption>
              </figure>
              <figure className="ring-unit">
                <div className="ring ring--hours" style={{ '--pct': `${pct}%` }}>
                  <div className="ring__center">
                    <strong>{formatLeaveHoursOnly(remaining)}</strong>
                    <span>of {formatLeaveHoursOnly(quotaTotal)}</span>
                  </div>
                </div>
                <figcaption>Hours</figcaption>
              </figure>
            </div>

            <div className="leave-bars">
              {PANELS.map((panel) => (
                <div className="leave-bars__panel" key={panel.key}>
                  <h3>{panel.title}</h3>
                  <ul>
                    {rows.map((r) => (
                      <li key={r.key}>
                        <span className="leave-bars__top">
                          <span className="leave-bars__label" title={r.label}>
                            {r.label}
                            {r.period !== 'year' && <em> /{r.period}</em>}
                          </span>
                          <b className={r.left === 0 ? 'is-spent' : undefined}>{panel.value(r)}</b>
                        </span>
                        <span className="leave-bars__track">
                          <span
                            className={`leave-bars__fill ${r.tint}`}
                            style={{ width: `${r.pct}%` }}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
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
