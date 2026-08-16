import { useCallback, useMemo, useState } from 'react'
import Icon from './Icon'
import Modal from './Modal'
import Avatar from './Avatar'
import WhenPicker, { DAY_PART_TIMES, yearEndStr } from './WhenPicker'
import { useAuth } from '../context/AuthContext'
import { leaves as leavesApi } from '../lib/hrms'
import { perDayFraction, roundDays, isWeeklyOff, workingDayCount } from '../lib/leave'
import { formatLeaveAmount } from '../lib/format'
import { haptic } from '../lib/haptics'
import { useSessionState } from '../lib/useSessionState'
import { InlineError } from './States'

const MAX_REASON = 500
const WEEKLY_OFF_ERROR = 'Sundays are weekly offs — pick a working day.'

const BLANK_WHEN = {
  mode: 'range',
  startDate: '',
  endDate: '',
  dates: [],
  dayPart: 'full',
  ...DAY_PART_TIMES.full,
}

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
  // What the person picked/typed survives a page refresh (per tab, per user —
  // lib/useSessionState.js); closing on purpose or submitting clears it.
  const [when, setWhen] = useSessionState('draft.applyWfh.when', BLANK_WHEN)
  const [reason, setReason] = useSessionState('draft.applyWfh.reason', '')
  const [touched, setTouched] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const clearDraft = useCallback(() => {
    setWhen(BLANK_WHEN)
    setReason('')
  }, [setWhen, setReason])
  // Stable identity: Modal re-runs its focus/keyboard effect when onClose
  // changes (see ApplyLeaveModal for the full note).
  const close = useCallback(() => {
    clearDraft()
    onClose()
  }, [clearDraft, onClose])

  const { mode, startDate, endDate, dates, dayPart, startTime, endTime } = when
  const custom = mode === 'custom'
  // Same hours-based sizing as leave (8h = 1 day, working days only — Sundays
  // are weekly offs) — WFH just has no balance.
  const perDay = perDayFraction(dayPart, startTime, endTime)
  const days = custom
    ? roundDays(dates.length * perDay)
    : startDate ? roundDays(workingDayCount(startDate, endDate || startDate) * perDay) : 0

  const errors = useMemo(() => {
    const e = {}
    const yearEnd = yearEndStr()
    if (custom) {
      if (dates.length === 0) e.dates = 'Add at least one date.'
      else if (dates.some((d) => d > yearEnd)) e.dates = 'Dates must fall within the current year.'
      else if (dates.some(isWeeklyOff)) e.dates = 'Sundays are weekly offs — remove them.'
    } else {
      if (!startDate) e.startDate = 'Pick a start date.'
      else if (startDate > yearEnd) e.startDate = 'Dates must fall within the current year.'
      else if (isWeeklyOff(startDate)) e.startDate = WEEKLY_OFF_ERROR
      if (!endDate) e.endDate = 'Pick an end date.'
      else if (startDate && endDate < startDate) {
        e.endDate = 'The end date can’t be before the start date.'
      } else if (endDate > yearEnd) {
        e.endDate = 'Dates must fall within the current year.'
      } else if (isWeeklyOff(endDate)) {
        e.endDate = WEEKLY_OFF_ERROR
      }
    }
    if (!startTime || !endTime) e.time = 'Pick the working hours.'
    else if (
      (dayPart === 'custom' || custom || (startDate && startDate === endDate)) &&
      endTime <= startTime
    ) {
      e.time = 'The end time must be after the start time.'
    }
    if (!reason.trim()) e.reason = 'Let your manager know why you’ll be working from home.'
    else if (reason.trim().length > MAX_REASON) e.reason = `Keep it under ${MAX_REASON} characters.`
    return e
  }, [custom, dates, startDate, endDate, startTime, endTime, reason, dayPart])

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
      close()
    } catch (err) {
      setSubmitError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <Modal titleId="apply-wfh-title" onClose={close}>
      <div className="modal__head">
        <h2 id="apply-wfh-title">Request work from home</h2>
        <button className="icon-btn sm" onClick={close} aria-label="Close dialog">
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
            {formatLeaveAmount(days)} requested
          </p>
        )}

        <div className="modal__actions">
          <button type="button" className="btn-tactile ghost" onClick={close} disabled={submitting}>
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
