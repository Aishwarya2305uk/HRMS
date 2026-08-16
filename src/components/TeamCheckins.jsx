import { useCallback, useEffect, useRef, useState } from 'react'
import Avatar from './Avatar'
import Icon from './Icon'
import { haptic } from '../lib/haptics'
import { checkInOriginLabel, formatDate, formatHours, formatTime } from '../lib/format'
import { attendance } from '../lib/hrms'
import { useAsyncData } from '../lib/useAsyncData'
import { useSessionState } from '../lib/useSessionState'
import { Skeleton, InlineError } from './States'

/** Today's 'YYYY-MM-DD' — UTC, the same day key the server stamps sessions with. */
const todayKey = () => new Date().toISOString().slice(0, 10)

const FILTER_LABELS = { all: 'All', in: 'Checked in', out: 'Not in' }

/**
 * The daily check-in roll-call that hangs under the check-in card for managers
 * and admins: who has started their day, when, and roughly where from.
 *
 * WHO is listed is decided entirely by the server from the caller's role (see
 * GET /api/attendance/daily) — an admin gets the whole company, a manager only
 * their own reporting subtree. This component never asks for a scope, so there
 * is nothing here for a manager to tamper with; `scope` comes back purely to
 * title the panel honestly ("Team check-ins" vs "Company check-ins").
 *
 * The location line is IP-derived and city-level at best — a VPN or a mobile
 * carrier will report the wrong city — so it's labelled as approximate rather
 * than presented as a verified whereabouts.
 */
export default function TeamCheckins() {
  // Survives a refresh (per tab) so a manager comes back to the day they were
  // reviewing, exactly like the admin All-attendance lens does.
  const [date, setDate] = useSessionState('ui.teamCheckins.date', '')
  const [filter, setFilter] = useSessionState('ui.teamCheckins.filter', 'all')
  const [expanded, setExpanded] = useState(false)

  const effectiveDate = date || todayKey()
  const { data, error, loading, reload } = useAsyncData(
    useCallback(() => attendance.daily(effectiveDate), [effectiveDate]),
  )

  // useAsyncData fetches on mount and then only when `enabled` flips — a new
  // date changes the fetcher's closure, which it deliberately ignores — so the
  // date change needs an explicit reload. The ref skips the very first run,
  // which the mount fetch already covered.
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    reload()
  }, [effectiveDate, reload])

  function pickDay(value) {
    haptic('light')
    setDate(value)
  }

  const rows = data?.rows ?? []
  const summary = data?.summary ?? { total: 0, checkedIn: 0, onLeave: 0, absent: 0 }
  const isTeam = data?.scope === 'team'
  // Neutral until the server has told us the scope — a manager shouldn't see
  // "Company check-ins" flash above their own team's list while it loads.
  const title = !data ? 'Daily check-ins' : isTeam ? 'Team check-ins' : 'Company check-ins'
  const counts = {
    all: summary.total,
    in: summary.checkedIn,
    out: summary.onLeave + summary.absent,
  }
  const filtered =
    filter === 'in' ? rows.filter((r) => r.checkedIn) : filter === 'out' ? rows.filter((r) => !r.checkedIn) : rows
  // A long roster would dwarf the check-in card it sits under, so only the
  // first few show until the viewer asks for the rest.
  const VISIBLE = 6
  const shown = expanded ? filtered : filtered.slice(0, VISIBLE)

  return (
    <section className="checkins">
      <div className="checkins__head">
        <h3>
          {title}
          {isTeam && <span className="checkins__scope">your reports</span>}
        </h3>
        <div className="checkins__head-actions">
          <input
            type="date"
            className="cal-date"
            value={effectiveDate}
            max={todayKey()}
            onChange={(e) => pickDay(e.target.value)}
            aria-label="Show check-ins for a specific date"
          />
          <button
            type="button"
            className="icon-btn sm"
            onClick={() => {
              haptic('light')
              reload()
            }}
            disabled={loading}
            aria-label="Refresh check-ins"
            title="Refresh"
          >
            <Icon name="refreshCw" size={15} />
          </button>
        </div>
      </div>

      {error && <InlineError onRetry={reload}>{error.message}</InlineError>}

      {loading && data === null ? (
        <Skeleton rows={3} />
      ) : (
        <>
          <div className="seg checkins__seg">
            {['all', 'in', 'out'].map((key) => (
              <button
                key={key}
                type="button"
                className={`seg__btn${filter === key ? ' is-active' : ''}`}
                onClick={() => setFilter(key)}
              >
                {FILTER_LABELS[key]} <b>{counts[key]}</b>
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="checkins__empty">
              {summary.total === 0
                ? isTeam
                  ? 'Nobody reports to you yet, so there are no check-ins to show.'
                  : 'No employees to show yet.'
                : filter === 'in'
                  ? `Nobody has checked in on ${formatDate(effectiveDate, true)} yet.`
                  : `Everyone in scope has checked in on ${formatDate(effectiveDate, true)}.`}
            </p>
          ) : (
            <ul className="checkins__list">
              {shown.map((r) => (
                <li key={r.employeeId} className="checkin">
                  {/* Initials only — the endpoint deliberately doesn't ship
                      profile photos (inline data URLs, far too heavy for a
                      whole-company list that loads with the dashboard). */}
                  <Avatar name={r.employeeName} size="sm" />
                  <div className="checkin__who">
                    <strong>{r.employeeName}</strong>
                    <em>{r.designation || r.department || '—'}</em>
                    {r.checkedIn && (
                      <span className="checkin__origin">
                        <Icon name="mapPin" size={12} />
                        {checkInOriginLabel(r) || 'No network details recorded'}
                        {r.checkInIp && <span className="checkin__ip">{r.checkInIp}</span>}
                      </span>
                    )}
                  </div>
                  <div className="checkin__when">
                    <b>{r.checkedIn ? formatTime(r.checkInAt) : '—'}</b>
                    <StatusPill row={r} />
                    {r.checkedIn && r.workedSeconds > 0 && (
                      <span className="checkin__worked">{formatHours(r.workedSeconds)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {filtered.length > VISIBLE && (
            <button type="button" className="link-btn checkins__more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show less' : `Show all ${filtered.length}`}
            </button>
          )}
        </>
      )}

      <p className="checkins__note">
        City and country are estimated from the check-in IP address — approximate, and wrong on a
        VPN or mobile network. Check-ins made over localhost or a private network have no public
        location to resolve.
      </p>
    </section>
  )
}

/** Where this person stands on the selected day, in one pill. */
function StatusPill({ row }) {
  if (row.running) return <span className="status approved">Working</span>
  if (row.timerState === 'paused') return <span className="status pending">Paused</span>
  if (row.checkedIn) {
    return (
      <span className={`status ${row.dayStatus === 'leave' ? 'auto-leave' : 'present'}`}>
        {row.dayStatus === 'leave' ? 'Short day' : 'Present'}
      </span>
    )
  }
  if (row.onLeave) return <span className="status approved">On {row.onLeave.label}</span>
  // Deliberately the muted pill, not the red one: "hasn't started yet" is a
  // fact about the clock, not a verdict on the person.
  return <span className="status cancelled">Not checked in</span>
}
