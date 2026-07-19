import { useState } from 'react'
import Icon from './Icon'
import { leaves as leavesApi } from '../lib/hrms'
import { haptic } from '../lib/haptics'

/** Inclusive calendar-day count between two YYYY-MM-DD strings (client preview). */
function dayCount(start, end) {
  if (!start || !end || end < start) return 0
  return Math.floor((new Date(end) - new Date(start)) / 86400000) + 1
}

/**
 * Modal form to apply for leave. Mirrors backend validation (range + balance)
 * for instant feedback, but the server remains the source of truth.
 *
 * @param {Array}    props.types     [{ key, label, quota }]
 * @param {object}   props.balances  remaining days per type
 * @param {()=>void} props.onClose
 * @param {(leave)=>void} props.onCreated  called with the new leave on success
 */
export default function ApplyLeaveModal({ types, balances, onClose, onCreated }) {
  const [type, setType] = useState(types[0]?.key ?? 'casual')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const days = dayCount(startDate, endDate)
  const remaining = Number(balances?.[type]) || 0
  const overBalance = days > remaining

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!startDate || !endDate) return setError('Please pick both dates.')
    if (endDate < startDate) return setError('End date cannot be before the start date.')
    if (overBalance) return setError(`Only ${remaining} day(s) of that leave remain.`)

    setSubmitting(true)
    haptic('medium')
    try {
      const leave = await leavesApi.apply({ type, startDate, endDate, reason })
      haptic('success')
      onCreated?.(leave)
      onClose()
    } catch (err) {
      setError(err.message || 'Could not submit your request.')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Apply for leave" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Apply for leave</h2>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && (
          <div className="auth-error" role="alert">
            <span aria-hidden="true">⚠️</span>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="lv-type">Leave type</label>
            <select id="lv-type" value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label} · {Number(balances?.[t.key]) || 0} left
                </option>
              ))}
            </select>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="lv-start">Start date</label>
              <input id="lv-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="lv-end">End date</label>
              <input id="lv-end" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} required />
            </div>
          </div>

          <div className="field">
            <label htmlFor="lv-reason">Reason</label>
            <textarea id="lv-reason" rows={3} value={reason} placeholder="A short note for your manager…" onChange={(e) => setReason(e.target.value)} />
          </div>

          {days > 0 && (
            <p className={`apply-summary${overBalance ? ' over' : ''}`}>
              <Icon name="calendar" size={15} />
              {days} day{days > 1 ? 's' : ''} requested · {remaining} available
            </p>
          )}

          <div className="modal__actions">
            <button type="button" className="btn-tactile ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-tactile primary" disabled={submitting || overBalance}>
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
