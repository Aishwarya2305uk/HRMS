import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { haptic } from '../lib/haptics'
import { formatElapsed, formatHours, formatTime } from '../lib/format'
import { attendance } from '../lib/hrms'

/**
 * Zoho-style check-in timer, backed by the server event log.
 *
 * The elapsed time is authoritative on the server: we fetch today's session
 * (workedSeconds + running flag) and only *display* a locally-ticking counter
 * on top of the last sync. That's what makes it refresh- and re-login-proof —
 * reloading the page just re-reads the true elapsed time from the API.
 *
 * @param {(session:object)=>void} [props.onChange]  notified after each action
 */
export default function AttendanceCard({ onChange }) {
  const [session, setSession] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Wall-clock time of the last server sync + the workedSeconds at that moment.
  const sync = useRef({ at: Date.now(), base: 0, running: false })

  const apply = useCallback(
    (live) => {
      setSession(live)
      sync.current = {
        at: Date.now(),
        base: live.workedSeconds ?? 0,
        running: Boolean(live.running),
      }
      setNow(Date.now())
      onChange?.(live)
    },
    [onChange],
  )

  // Initial load.
  useEffect(() => {
    let active = true
    attendance
      .today()
      .then((live) => active && apply(live))
      .catch(() => active && setError('Could not load attendance.'))
    return () => {
      active = false
    }
  }, [apply])

  // Tick once a second only while the timer is actually running.
  useEffect(() => {
    if (!sync.current.running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [session])

  async function act(action, feel = 'medium') {
    if (busy) return
    setBusy(true)
    setError('')
    haptic(feel)
    try {
      const live = await attendance.action(action)
      apply(live)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const state = session?.timerState ?? 'out'
  const running = state === 'running'
  const liveSeconds =
    sync.current.base + (sync.current.running ? (now - sync.current.at) / 1000 : 0)
  const elapsed = formatElapsed(liveSeconds)

  const statusLabel =
    state === 'running'
      ? 'Checked in'
      : state === 'paused'
        ? 'Paused'
        : state === 'done'
          ? 'Checked out'
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
          You worked <b>{formatHours(session.workedSeconds)}</b> today · checked out at{' '}
          {formatTime(session.checkOutAt)}.{' '}
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
              : "You're not checked in yet. Start your day whenever you're ready."}
        </p>
      )}

      {error && (
        <div className="auth-error" role="alert" style={{ marginBottom: 12 }}>
          <span aria-hidden="true">⚠️</span>
          {error}
        </div>
      )}

      {state === 'out' && (
        <button className="btn-tactile primary block" onClick={() => act('check-in', 'success')} disabled={busy}>
          <Icon name="check" size={18} />
          Check in
        </button>
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
        {`A full day is 8h — under that auto-marks the day as leave. Logging in doesn't mark attendance.`}
      </p>
    </section>
  )
}
