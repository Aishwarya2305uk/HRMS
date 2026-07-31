import { useMemo, useState } from 'react'
import Icon from './Icon'
import Modal from './Modal'
import Avatar from './Avatar'
import WhenPicker, { DAY_PART_TIMES } from './WhenPicker'
import { useAuth } from '../context/AuthContext'
import { leaves as leavesApi } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { InlineError } from './States'

/** Inclusive calendar-day count between two YYYY-MM-DD strings (client preview). */
function dayCount(start, end) {
  if (!start || !end || end < start) return 0
  return Math.floor((new Date(end) - new Date(start)) / 86400000) + 1
}

/**
 * Modal form to apply for leave.
 *
 * UX approach:
 *  - Validation is per-field and shown *under the field it belongs to*, so the
 *    user knows exactly what to fix (a single form-level error makes them hunt).
 *  - Errors appear only after a field is touched or on submit — validating
 *    while someone is still typing their first character is hostile.
 *  - A live summary ("3 days requested · 12 available") gives feedback before
 *    they commit, which prevents the error rather than reporting it.
 *  - The server stays the source of truth; these checks only save a round trip.
 */
export default function ApplyLeaveModal({ types, balances, onClose, onCreated }) {
  const { user } = useAuth()
  const [type, setType] = useState(types[0]?.key ?? '')
  const [when, setWhen] = useState({
    mode: 'range',
    startDate: '',
    endDate: '',
    dates: [],
    dayPart: 'full',
    ...DAY_PART_TIMES.full,
  })
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { mode, startDate, endDate, dates, dayPart, startTime, endTime } = when
  const custom = mode === 'custom'
  const days = custom
    ? dayPart === 'full' ? dates.length : dates.length ? 0.5 : 0
    : dayPart === 'full' ? dayCount(startDate, endDate) : startDate ? 0.5 : 0
  const remaining = Number(balances?.[type]) || 0

  /** Field-level validation, recomputed as the user types. */
  const errors = useMemo(() => {
    const e = {}
    if (custom) {
      if (dates.length === 0) e.dates = 'Add at least one date.'
    } else {
      if (!startDate) e.startDate = 'Pick a start date.'
      if (!endDate) e.endDate = 'Pick an end date.'
      else if (startDate && endDate < startDate) {
        e.endDate = 'The end date can’t be before the start date.'
      }
    }
    if (!startTime || !endTime) e.time = 'Pick the working hours.'
    else if ((custom || (startDate && startDate === endDate)) && endTime <= startTime) {
      e.time = 'The end time must be after the start time.'
    }
    if (days > 0 && days > remaining) {
      e.type =
        remaining === 0
          ? 'You have no days left of this leave type.'
          : `That's ${days} day${days > 1 ? 's' : ''}, but only ${remaining} remain.`
    }
    return e
  }, [custom, dates, startDate, endDate, startTime, endTime, days, remaining])

  const isValid = Object.keys(errors).length === 0
  /** Show a field's error once it's been touched, or after a submit attempt. */
  const showError = (field) => (touched[field] || touched._submitted) && errors[field]

  function markTouched(field) {
    setTouched((t) => ({ ...t, [field]: true }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError('')
    setTouched((t) => ({ ...t, _submitted: true }))
    if (!isValid) {
      // Move focus to the first problem so keyboard/screen-reader users land on it.
      const firstBad = ['dates', 'startDate', 'endDate', 'time', 'type'].find((f) => errors[f])
      const focusId = { dates: 'draftDate', time: 'startTime' }[firstBad] ?? firstBad
      document.getElementById(`lv-${focusId}`)?.focus()
      return
    }

    setSubmitting(true)
    haptic('medium')
    try {
      // Custom mode sends the picked dates; the server groups consecutive
      // ones and returns one created request per block (an array).
      const leave = await leavesApi.apply({
        type,
        ...(custom ? { dates } : { startDate, endDate }),
        dayPart,
        startTime,
        endTime,
        reason,
      })
      haptic('success')
      onCreated?.(leave)
      onClose()
    } catch (err) {
      setSubmitError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <Modal titleId="apply-leave-title" onClose={onClose}>
      <div className="modal__head">
        <h2 id="apply-leave-title">Apply for leave</h2>
        <button className="icon-btn sm" onClick={onClose} aria-label="Close dialog">
          <Icon name="x" size={16} />
        </button>
      </div>

      {submitError && <InlineError>{submitError}</InlineError>}

      {/* Who this request is filed as — the same identity (employee ID +
          email) the approving manager sees on the request card. */}
      <div className="apply-ident">
        <Avatar name={user?.name} photoUrl={user?.photoUrl} size="sm" />
        <div className="apply-ident__text">
          <strong>{user?.name}</strong>
          <em>{[user?.employeeId, user?.email].filter(Boolean).join(' · ')}</em>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="lv-type">Leave type</label>
          <select
            id="lv-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            onBlur={() => markTouched('type')}
            aria-invalid={Boolean(showError('type'))}
            aria-describedby={showError('type') ? 'err-type' : undefined}
          >
            {types.map((t) => {
              const left = Number(balances?.[t.key]) || 0
              return (
                <option key={t.key} value={t.key} disabled={left === 0}>
                  {t.label} · {left === 0 ? 'none left' : `${left} left`}
                </option>
              )
            })}
          </select>
          {showError('type') && (
            <p className="field-error" id="err-type">{errors.type}</p>
          )}
        </div>

        <WhenPicker
          idPrefix="lv"
          value={when}
          onChange={(patch) => setWhen((w) => ({ ...w, ...patch }))}
          showError={showError}
          errors={errors}
          markTouched={markTouched}
        />

        <div className="field">
          <label htmlFor="lv-reason">
            Reason <span className="field-optional">(optional)</span>
          </label>
          <textarea
            id="lv-reason"
            rows={3}
            value={reason}
            maxLength={500}
            placeholder="A short note for your manager…"
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="field-hint">{500 - reason.length} characters remaining</p>
        </div>

        {/* Live, non-blocking summary so the outcome is clear before submitting. */}
        {days > 0 && (
          <p className={`apply-summary${errors.type ? ' over' : ''}`} aria-live="polite">
            <Icon name="calendar" size={15} />
            {days === 0.5 ? 'Half a day' : `${days} day${days > 1 ? 's' : ''}`} requested ·{' '}
            {remaining} available
          </p>
        )}

        <div className="modal__actions">
          <button type="button" className="btn-tactile ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn-tactile primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
