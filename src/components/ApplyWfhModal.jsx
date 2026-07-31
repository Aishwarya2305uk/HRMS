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

const MAX_REASON = 500

/**
 * Modal form to request working from home for a date range.
 *
 * Unlike leave, this never touches any balance — it's a location change, not
 * time off — so there's no type selector and no remaining-balance summary.
 * The one thing it insists on that leave doesn't is a reason: with no quota
 * to check against, the approving manager has nothing else to go on.
 */
export default function ApplyWfhModal({ onClose, onCreated }) {
  const { user } = useAuth()
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
    if (!reason.trim()) e.reason = 'Let your manager know why you’ll be working from home.'
    else if (reason.trim().length > MAX_REASON) e.reason = `Keep it under ${MAX_REASON} characters.`
    return e
  }, [custom, dates, startDate, endDate, startTime, endTime, reason])

  const isValid = Object.keys(errors).length === 0
  const showError = (field) => (touched[field] || touched._submitted) && errors[field]

  function markTouched(field) {
    setTouched((t) => ({ ...t, [field]: true }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError('')
    setTouched((t) => ({ ...t, _submitted: true }))
    if (!isValid) {
      const firstBad = ['dates', 'startDate', 'endDate', 'time', 'reason'].find((f) => errors[f])
      const focusId = { dates: 'draftDate', time: 'startTime' }[firstBad] ?? firstBad
      document.getElementById(`wfh-${focusId}`)?.focus()
      return
    }

    setSubmitting(true)
    haptic('medium')
    try {
      // Custom mode sends the picked dates; the server groups consecutive
      // ones and returns one created request per block (an array).
      const wfh = await leavesApi.applyWfh({
        ...(custom ? { dates } : { startDate, endDate }),
        dayPart,
        startTime,
        endTime,
        reason: reason.trim(),
      })
      haptic('success')
      onCreated?.(wfh)
      onClose()
    } catch (err) {
      setSubmitError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <Modal titleId="apply-wfh-title" onClose={onClose}>
      <div className="modal__head">
        <h2 id="apply-wfh-title">Request work from home</h2>
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
        <WhenPicker
          idPrefix="wfh"
          value={when}
          onChange={(patch) => setWhen((w) => ({ ...w, ...patch }))}
          showError={showError}
          errors={errors}
          markTouched={markTouched}
        />

        <div className="field">
          <label htmlFor="wfh-reason">Reason</label>
          <textarea
            id="wfh-reason"
            rows={3}
            value={reason}
            maxLength={MAX_REASON}
            placeholder="e.g. Waiting for a home delivery, internet installation at the office…"
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => markTouched('reason')}
            aria-invalid={Boolean(showError('reason'))}
            aria-describedby={showError('reason') ? 'err-wfh-reason' : 'hint-wfh-reason'}
            required
          />
          {showError('reason') ? (
            <p className="field-error" id="err-wfh-reason">{errors.reason}</p>
          ) : (
            <p className="field-hint" id="hint-wfh-reason">{MAX_REASON - reason.length} characters remaining</p>
          )}
        </div>

        {days > 0 && (
          <p className="apply-summary" aria-live="polite">
            <Icon name="calendar" size={15} />
            {days === 0.5 ? 'Half a day' : `${days} day${days > 1 ? 's' : ''}`} requested
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
