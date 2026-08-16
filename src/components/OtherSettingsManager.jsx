import { useState } from 'react'
import { appSettings as appSettingsApi } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { useSessionState } from '../lib/useSessionState'
import { useToast } from '../context/ToastContext'
import Icon from './Icon'
import { Skeleton, InlineError } from './States'

const URL_MAX = 2048

// Icons mirror the matching sidebar items so the pairing is obvious.
const FIELDS = [
  {
    key: 'feedbackFormUrl',
    label: 'Feedback form',
    icon: 'messageSquare',
    hint: 'Opens when anyone clicks "Feedback" at the bottom of the sidebar.',
  },
  {
    key: 'hrRequestFormUrl',
    label: 'HR request form',
    icon: 'lifeBuoy',
    hint: 'Opens when anyone clicks "HR Request" at the bottom of the sidebar.',
  },
]

// The two ways of marking attendance, shown/hidden per org. Hiding never
// deletes anything — the buttons just disappear from dashboards until the
// method is turned back on (the server refuses hidden methods too).
const ATTENDANCE_TOGGLES = [
  {
    key: 'attendanceQuickCheckinEnabled',
    label: '“Check in for today” button',
    icon: 'check',
    hint: 'One tap marks the whole day as present (8h) — no timer to run.',
    detail:
      'The simplest way to mark attendance: a single button that logs a full 8h day and marks the person present — no pause or check-out needed.',
  },
  {
    key: 'attendanceTimerEnabled',
    label: 'Check-in timer',
    icon: 'clock',
    hint: 'Live check in / pause / resume / check out — under 8h auto-marks leave.',
    detail:
      'The classic timer: people check in, pause for breaks and check out, and a day under 8h auto-marks as leave. Hiding it stops new timer check-ins; anyone already checked in today can still finish their day.',
  },
]

/** Empty is fine (clears the link); anything else must be a full http(s) URL. */
function isValidLink(raw) {
  if (!raw) return true
  if (raw.length > URL_MAX) return false
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Admin editing of the org-wide settings (Other Settings page): the external
 * form links, plus which attendance check-in methods appear on dashboards.
 * Each setting is a collapsible row — header shows what it is and its current
 * state; expanding it reveals the control (URL input / show-hide button), and
 * each saves independently. Receives Portal's settings query so a save
 * immediately updates the same data the sidebar items and AttendanceCard
 * read — no refetch needed.
 */
export default function OtherSettingsManager({ query }) {
  const toast = useToast()
  // Unsaved edits and the expanded row survive a page refresh (per tab, per
  // user — lib/useSessionState.js); saving clears that field's draft.
  const [drafts, setDrafts] = useSessionState('draft.otherSettings.values', {})
  const [savingKey, setSavingKey] = useState(null)
  // Which accordion row is expanded (one at a time), or null for none.
  const [openKey, setOpenKey] = useSessionState('ui.otherSettings.openKey', null)

  const settings = query.data
  if (query.loading && settings === null) return <Skeleton rows={2} />
  if (query.error && settings === null) {
    return <InlineError onRetry={query.reload}>{query.error.message}</InlineError>
  }

  const valueFor = (key) => drafts[key] ?? settings?.[key] ?? ''
  const isDirty = (key) => valueFor(key).trim() !== (settings?.[key] ?? '')

  function toggle(key) {
    haptic('light')
    setOpenKey((k) => (k === key ? null : key))
  }

  async function save(field) {
    const val = valueFor(field.key).trim()
    if (!isValidLink(val)) {
      toast.error(`${field.label}: enter a full link starting with http:// or https://`)
      return
    }
    if (!isDirty(field.key)) return
    setSavingKey(field.key)
    haptic('medium')
    try {
      const updated = await appSettingsApi.update({ [field.key]: val })
      query.setData(updated)
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[field.key]
        return next
      })
      haptic('success')
      toast.success(
        val
          ? `${field.label} link saved — the sidebar option now opens it.`
          : `${field.label} link cleared — the sidebar option is disabled until a new one is set.`,
      )
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingKey(null)
    }
  }

  /** Flip one attendance method on/off — saves immediately, like the links. */
  async function saveToggle(field, value) {
    if (savingKey) return
    setSavingKey(field.key)
    haptic('medium')
    try {
      const updated = await appSettingsApi.update({ [field.key]: value })
      query.setData(updated)
      haptic('success')
      toast.success(
        value
          ? `${field.label} is now on everyone's dashboard.`
          : `${field.label} hidden — nothing is deleted, bring it back anytime.`,
      )
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingKey(null)
    }
  }

  const bothHidden =
    settings != null && !settings.attendanceTimerEnabled && !settings.attendanceQuickCheckinEnabled

  return (
    <>
    <section className="card pop" style={{ '--d': '40ms' }}>
      <div className="attendance__head">
        <h2>
          Feedback &amp; HR request forms
          <span className="settings-acc__count">{FIELDS.length} settings</span>
        </h2>
      </div>
      <p className="field-hint team-manager__hint">
        Everyone sees Feedback and HR Request at the bottom of their sidebar. Paste the form links
        (e.g. Google Forms) they should open — leave one empty to disable it for now.
      </p>

      <div className="settings-acc">
        {FIELDS.map((f) => {
          const open = openKey === f.key
          const isSet = Boolean((settings?.[f.key] ?? '').trim())
          return (
            <div className={`settings-acc__item${open ? ' is-open' : ''}`} key={f.key}>
              <button
                type="button"
                className="settings-acc__head"
                aria-expanded={open}
                aria-controls={`os-panel-${f.key}`}
                onClick={() => toggle(f.key)}
              >
                <span className="settings-acc__icon">
                  <Icon name={f.icon} size={17} />
                </span>
                <span className="settings-acc__text">
                  <strong>{f.label}</strong>
                  <em>{f.hint}</em>
                </span>
                <span className={`settings-acc__state${isSet ? ' is-set' : ''}`}>
                  {isSet ? 'Set' : 'Not set'}
                </span>
                <Icon name="chevronDown" size={16} className="settings-acc__chevron" />
              </button>

              {open && (
                <div className="settings-acc__body" id={`os-panel-${f.key}`}>
                  <form
                    className="field"
                    onSubmit={(e) => {
                      e.preventDefault()
                      save(f)
                    }}
                  >
                    <label htmlFor={`os-${f.key}`}>Form link</label>
                    <div className="leave-type-add">
                      <input
                        id={`os-${f.key}`}
                        type="url"
                        inputMode="url"
                        maxLength={URL_MAX}
                        value={valueFor(f.key)}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder="https://forms.gle/…"
                        aria-invalid={!isValidLink(valueFor(f.key).trim()) || undefined}
                      />
                      <button
                        type="submit"
                        className="btn-tactile primary sm"
                        disabled={savingKey === f.key || !isDirty(f.key)}
                      >
                        <Icon name="check" size={15} />
                        {savingKey === f.key ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>

    <section className="card pop" style={{ '--d': '80ms' }}>
      <div className="attendance__head">
        <h2>
          Attendance check-in
          <span className="settings-acc__count">{ATTENDANCE_TOGGLES.length} settings</span>
        </h2>
      </div>
      <p className="field-hint team-manager__hint">
        Choose how people mark attendance on their dashboard — show one way or both. Hiding a
        method only tucks it away for now: history is kept, and you can bring it back anytime.
      </p>

      <div className="settings-acc">
        {ATTENDANCE_TOGGLES.map((f) => {
          const open = openKey === f.key
          const on = Boolean(settings?.[f.key])
          return (
            <div className={`settings-acc__item${open ? ' is-open' : ''}`} key={f.key}>
              <button
                type="button"
                className="settings-acc__head"
                aria-expanded={open}
                aria-controls={`os-panel-${f.key}`}
                onClick={() => toggle(f.key)}
              >
                <span className="settings-acc__icon">
                  <Icon name={f.icon} size={17} />
                </span>
                <span className="settings-acc__text">
                  <strong>{f.label}</strong>
                  <em>{f.hint}</em>
                </span>
                <span className={`settings-acc__state${on ? ' is-set' : ''}`}>
                  {on ? 'Shown' : 'Hidden'}
                </span>
                <Icon name="chevronDown" size={16} className="settings-acc__chevron" />
              </button>

              {open && (
                <div className="settings-acc__body" id={`os-panel-${f.key}`}>
                  <p className="field-hint team-manager__hint">{f.detail}</p>
                  <button
                    type="button"
                    className={`btn-tactile ${on ? 'ghost' : 'primary'} sm`}
                    onClick={() => saveToggle(f, !on)}
                    disabled={savingKey === f.key}
                  >
                    <Icon name={on ? 'eyeOff' : 'eye'} size={15} />
                    {savingKey === f.key
                      ? 'Saving…'
                      : on
                        ? 'Hide from dashboards'
                        : 'Show on dashboards'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {bothHidden && (
        <p className="field-hint team-manager__hint">
          Both methods are hidden right now, so nobody can mark attendance. Turn one back on
          when you&rsquo;re ready.
        </p>
      )}
    </section>
    </>
  )
}
