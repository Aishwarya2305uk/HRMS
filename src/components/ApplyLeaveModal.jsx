import { useMemo, useState } from 'react'
import Icon from './Icon'
import Modal from './Modal'
import { leaves as leavesApi } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { InlineError } from './States'

/** Inclusive calendar-day count between two YYYY-MM-DD strings (client preview). */
function dayCount(start, end) {
  if (!start || !end || end < start) return 0
  return Math.floor((new Date(end) - new Date(start)) / 86400000) + 1
}

const todayStr = () => new Date().toISOString().slice(0, 10)

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
  const [type, setType] = useState(types[0]?.key ?? 'casual')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const days = dayCount(startDate, endDate)
  const remaining = Number(balances?.[type]) || 0

  /** Field-level validation, recomputed as the user types. */
  const errors = useMemo(() => {
    const e = {}
    if (!startDate) e.startDate = 'Pick a start date.'
    if (!endDate) e.endDate = 'Pick an end date.'
    else if (startDate && endDate < startDate) {
      e.endDate = 'The end date can’t be before the start date.'
    }
    if (days > 0 && days > remaining) {
      e.type =
        remaining === 0
          ? 'You have no days left of this leave type.'
          : `That's ${days} days, but only ${remaining} remain.`
    }
    return e
  }, [startDate, endDate, days, remaining])

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
      const firstBad = ['startDate', 'endDate', 'type'].find((f) => errors[f])
      document.getElementById(`lv-${firstBad}`)?.focus()
      return
    }

    setSubmitting(true)
    haptic('medium')
    try {
      const leave = await leavesApi.apply({ type, startDate, endDate, reason })
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
        <button className="icon-btn sm" onClick={onClose} aria-label="Close dialog">✕</button>
      </div>

      {submitError && <InlineError>{submitError}</InlineError>}

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

        <div className="field-row">
          <div className="field">
            <label htmlFor="lv-startDate">Start date</label>
            <input
              id="lv-startDate"
              type="date"
              value={startDate}
              min={todayStr()}
              onChange={(e) => setStartDate(e.target.value)}
              onBlur={() => markTouched('startDate')}
              aria-invalid={Boolean(showError('startDate'))}
              aria-describedby={showError('startDate') ? 'err-start' : undefined}
              required
            />
            {showError('startDate') && (
              <p className="field-error" id="err-start">{errors.startDate}</p>
            )}
          </div>

          <div className="field">
            <label htmlFor="lv-endDate">End date</label>
            <input
              id="lv-endDate"
              type="date"
              value={endDate}
              min={startDate || todayStr()}
              onChange={(e) => setEndDate(e.target.value)}
              onBlur={() => markTouched('endDate')}
              aria-invalid={Boolean(showError('endDate'))}
              aria-describedby={showError('endDate') ? 'err-end' : undefined}
              required
            />
            {showError('endDate') && (
              <p className="field-error" id="err-end">{errors.endDate}</p>
            )}
          </div>
        </div>

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
            {days} day{days > 1 ? 's' : ''} requested · {remaining} available
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
