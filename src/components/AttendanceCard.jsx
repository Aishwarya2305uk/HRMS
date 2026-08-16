import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import TeamCheckins from './TeamCheckins'
import { haptic } from '../lib/haptics'
import { formatElapsed, formatHours, formatTime, formatRange } from '../lib/format'
import { attendance } from '../lib/hrms'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { InlineError } from './States'

/**
 * Zoho-style check-in timer, backed by the server event log.
 *
 * The elapsed time is authoritative on the server: we fetch today's session
 * (workedSeconds + running flag) and only *display* a locally-ticking counter
 * on top of the last sync. That's what makes it refresh- and re-login-proof —
 * reloading the page just re-reads the true elapsed time from the API.
 *
 * Which way(s) of marking attendance are offered is an admin choice (Other
 * Settings): the timer above, and/or the one-tap "Check in for today" that
 * marks the whole day present at 8h. `settings` is Portal's app-settings
 * query data — null until loaded, so buttons only render once the flags are
 * known. The server re-checks the flags, so this gating is UX, not security.
 * An already-running timer stays finishable even if the admin hides the
 * timer mid-day.
 *
 * On a day the person is on approved full-day leave, /attendance/today
 * carries `onLeave` (type label + dates): both check-in buttons render greyed
 * out with the reason, and the server refuses the action anyway.
 *
 * Every check-in also records the IP it arrived from and the city/country that
 * IP resolves to. The person who checked in sees their own origin line here;
 * managers and admins additionally get the daily roll-call panel at the foot
 * of this card (TeamCheckins — scoped server-side to their reports, or the
 * whole company for an admin).
 *
 * @param {(session:object)=>void} [props.onChange]  notified after each action
 * @param {object|null}            [props.settings]  org settings (attendance flags)
 */
export default function AttendanceCard({ onChange, settings }) {
  const { role } = useAuth()
  const toast = useToast()
  const [session, setSession] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  // Wall-clock time of the last server sync + the workedSeconds at that moment.
  const sync = useRef({ at: Date.now(), base: 0, running: false })

  // Held in a ref, NOT a dependency: onChange comes from the parent and gets a
  // fresh identity on every parent render. Depending on it here would re-create
  // `apply`, re-run the load effect, notify the parent, re-render it... an
  // infinite fetch loop. The ref lets us always call the latest callback while
  // keeping `apply` stable.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const apply = useCallback((live) => {
    setSession(live)
    sync.current = {
      at: Date.now(),
      base: live.workedSeconds ?? 0,
      running: Boolean(live.running),
    }
    setNow(Date.now())
    onChangeRef.current?.(live)
  }, [])

  /** Fetch today's session. Used on mount and by the retry button. */
  const load = useCallback(() => {
    setError('')
    return attendance
      .today()
      .then((live) => {
        setLoadFailed(false)
        apply(live)
      })
      .catch((err) => {
        setLoadFailed(true)
        setError(err.message)
      })
  }, [apply])

  // `load` is stable, so this runs once on mount.
  useEffect(() => {
    load()
  }, [load])

  // Tick once a second only while the timer is actually running.
  useEffect(() => {
    if (!sync.current.running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [session])

  /** Confirmation copy per action — states the outcome, not just "success". */
  const CONFIRM = {
    'check-in': () => 'Checked in. Your day has started.',
    pause: () => 'Paused — this time won’t be counted.',
    resume: () => 'Back on the clock.',
    'check-out': (live) =>
      `Checked out. You worked ${formatHours(live.workedSeconds)} today.`,
    'day-checkin': (live) =>
      `Checked in for today — you're marked present (${formatHours(live.workedSeconds)}).`,
  }

  async function act(action, feel = 'medium') {
    if (busy) return
    setBusy(true)
    setError('')
    haptic(feel)
    try {
      const live =
        action === 'day-checkin' ? await attendance.dayCheckin() : await attendance.action(action)
      apply(live)
      toast.success(CONFIRM[action]?.(live) ?? 'Attendance updated.')
    } catch (err) {
      // Shown inline (next to the control that failed) AND announced, because
      // an attendance action failing silently would cost the user real hours.
      setError(err.message)
      toast.error(err.message)
      // A refused START usually means today changed under us since the last
      // sync — e.g. leave approved while this page sat open — so re-read the
      // day and let the card reflect it (greyed buttons + reason) rather than
      // inviting another click.
      if (action === 'check-in' || action === 'day-checkin') load()
    } finally {
      setBusy(false)
    }
  }

  const state = session?.timerState ?? 'out'
  const running = state === 'running'
  const liveSeconds =
    sync.current.base + (sync.current.running ? (now - sync.current.at) / 1000 : 0)
  const elapsed = formatElapsed(liveSeconds)

  // Admin-controlled attendance methods; null settings = still loading, so
  // hold the start buttons rather than flashing the wrong set for a moment.
  const methodsKnown = settings != null
  const timerEnabled = Boolean(settings?.attendanceTimerEnabled)
  const quickEnabled = Boolean(settings?.attendanceQuickCheckinEnabled)

  // Approved full-day leave covering today (from /attendance/today) — the
  // start buttons stay visible but greyed, with the reason, on a leave day.
  const onLeave = state === 'out' ? (session?.onLeave ?? null) : null
  const leaveNote = onLeave
    ? `You're on approved ${onLeave.label} today${
        onLeave.startDate !== onLeave.endDate ? ` (${formatRange(onLeave.startDate, onLeave.endDate)})` : ''
      } — check-in isn't available on a leave day.`
    : ''

  const statusLabel =
    state === 'running'
      ? 'Checked in'
      : state === 'paused'
        ? 'Paused'
        : state === 'done'
          ? 'Checked out'
          : onLeave
            ? 'On leave'
            : 'Not started'

  return (
    <section className={`card attendance pop${running ? ' is-active' : ''}`} style={{ '--d': '300ms' }}>
      <div className="attendance__head">
        <h2>Attendance</h2>
        <span className={`live ${running ? 'on' : 'off'}`}>
          <span className="live__dot" />
          {statusLabel}
        </span>
      </div>

      <div className="attendance__timer" aria-live="polite">
        {elapsed}
      </div>

      {state === 'done' ? (
        <p className="attendance__hint">
          {session.checkOutAt ? (
            <>
              You worked <b>{formatHours(session.workedSeconds)}</b> today · checked out at{' '}
              {formatTime(session.checkOutAt)}.{' '}
            </>
          ) : (
            // One-tap day: no timer ran, so there's no checkout time to show.
            <>
              Checked in for today — <b>{formatHours(session.workedSeconds)}</b> logged.{' '}
            </>
          )}
          <span className={`status ${session.dayStatus === 'present' ? 'approved' : 'pending'}`}>
            {session.dayStatus === 'present' ? 'Present' : 'Marked leave'}
          </span>
        </p>
      ) : (
        <p className="attendance__hint">
          {state === 'running'
            ? 'Timer is running. Pause for breaks, and check out when you leave.'
            : state === 'paused'
              ? 'Paused — resume when you’re back. Paused time isn’t counted.'
              : onLeave
                ? leaveNote
                : methodsKnown && !timerEnabled && !quickEnabled
                  ? 'Attendance marking is currently turned off by your admin.'
                  : "You're not checked in yet. Start your day whenever you're ready."}
        </p>
      )}

      {/* Where today's check-in came from. Shown to the person themselves so
          the recording is never a surprise — it's the same IP + city/country
          their manager sees in the roll-call below. */}
      {session?.checkInAt && (
        <p className="attendance__origin">
          <Icon name="mapPin" size={13} />
          <span>
            Checked in at <b>{formatTime(session.checkInAt)}</b>
            {session.checkInLocation ? <> from {session.checkInLocation}</> : ''}
            {session.checkInIp && <span className="attendance__ip">{session.checkInIp}</span>}
          </span>
        </p>
      )}

      {error && <InlineError onRetry={loadFailed ? load : undefined}>{error}</InlineError>}

      {state === 'out' && (quickEnabled || timerEnabled) && (
        <div className="attendance__start">
          {quickEnabled && (
            <button
              className="btn-tactile primary block"
              onClick={() => act('day-checkin', 'success')}
              disabled={busy || Boolean(onLeave)}
              aria-disabled={Boolean(onLeave) || undefined}
              title={onLeave ? leaveNote : undefined}
            >
              <Icon name="check" size={18} />
              Check in for today
            </button>
          )}
          {timerEnabled && (
            <button
              className={`btn-tactile block${quickEnabled ? ' ghost' : ' primary'}`}
              onClick={() => act('check-in', 'success')}
              disabled={busy || Boolean(onLeave)}
              aria-disabled={Boolean(onLeave) || undefined}
              title={onLeave ? leaveNote : undefined}
            >
              <Icon name="clock" size={18} />
              {quickEnabled ? 'Check in with timer' : 'Check in'}
            </button>
          )}
        </div>
      )}

      {(state === 'running' || state === 'paused') && (
        <div className="attendance__actions">
          {running ? (
            <button className="btn-tactile ghost" onClick={() => act('pause', 'warning')} disabled={busy}>
              <Icon name="clock" size={18} />
              Pause
            </button>
          ) : (
            <button className="btn-tactile primary" onClick={() => act('resume', 'success')} disabled={busy}>
              <Icon name="check" size={18} />
              Resume
            </button>
          )}
          <button className="btn-tactile danger" onClick={() => act('check-out', 'warning')} disabled={busy}>
            <Icon name="logout" size={18} />
            Check out
          </button>
        </div>
      )}

      <p className="attendance__note">
        {timerEnabled
          ? `A full day is 8h — under that auto-marks the day as leave. Logging in doesn't mark attendance.`
          : quickEnabled
            ? `"Check in for today" marks your whole day present at 8h. Logging in doesn't mark attendance.`
            : `Your attendance history stays saved — marking will be back when your admin turns it on.`}
      </p>

      {/* Manager/admin only. The panel fetches its own data and the SERVER
          decides whose names it may contain, so rendering it here is a UI
          convenience, not the access control. */}
      {(role === 'manager' || role === 'admin') && <TeamCheckins />}
    </section>
  )
}
