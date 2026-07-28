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
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const days = dayCount(startDate, endDate)

  const errors = useMemo(() => {
    const e = {}
    if (!startDate) e.startDate = 'Pick a start date.'
    if (!endDate) e.endDate = 'Pick an end date.'
    else if (startDate && endDate < startDate) {
      e.endDate = 'The end date can’t be before the start date.'
    }
    if (!reason.trim()) e.reason = 'Let your manager know why you’ll be working from home.'
    else if (reason.trim().length > MAX_REASON) e.reason = `Keep it under ${MAX_REASON} characters.`
    return e
  }, [startDate, endDate, reason])

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
      const firstBad = ['startDate', 'endDate', 'reason'].find((f) => errors[f])
      document.getElementById(`wfh-${firstBad}`)?.focus()
      return
    }

    setSubmitting(true)
    haptic('medium')
    try {
      const wfh = await leavesApi.applyWfh({ startDate, endDate, reason: reason.trim() })
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

      <form onSubmit={handleSubmit} noValidate>
        <div className="field-row">
          <div className="field">
            <label htmlFor="wfh-startDate">Start date</label>
            <input
              id="wfh-startDate"
              type="date"
              value={startDate}
              min={todayStr()}
              onChange={(e) => setStartDate(e.target.value)}
              onBlur={() => markTouched('startDate')}
              aria-invalid={Boolean(showError('startDate'))}
              aria-describedby={showError('startDate') ? 'err-wfh-start' : undefined}
              required
            />
            {showError('startDate') && (
              <p className="field-error" id="err-wfh-start">{errors.startDate}</p>
            )}
          </div>

          <div className="field">
            <label htmlFor="wfh-endDate">End date</label>
            <input
              id="wfh-endDate"
              type="date"
              value={endDate}
              min={startDate || todayStr()}
              onChange={(e) => setEndDate(e.target.value)}
              onBlur={() => markTouched('endDate')}
              aria-invalid={Boolean(showError('endDate'))}
              aria-describedby={showError('endDate') ? 'err-wfh-end' : undefined}
              required
            />
            {showError('endDate') && (
              <p className="field-error" id="err-wfh-end">{errors.endDate}</p>
            )}
          </div>
        </div>

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
            {days} day{days > 1 ? 's' : ''} requested
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
