import { useMemo, useState } from 'react'
import Icon from './Icon'
import Modal from './Modal'
import Avatar from './Avatar'
import WhenPicker, { DAY_PART_TIMES, yearEndStr } from './WhenPicker'
import { useAuth } from '../context/AuthContext'
import { leaves as leavesApi } from '../lib/hrms'
import { perDayFraction, roundDays } from '../lib/leave'
import { formatLeaveAmount } from '../lib/format'
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
  // Hours-based size: each picked date consumes perDay days (1 full, 0.5
  // half, window÷8h for custom time) — mirrors the server's math.
  const perDay = perDayFraction(dayPart, startTime, endTime)
  const days = custom
    ? roundDays(dates.length * perDay)
    : startDate ? roundDays(dayCount(startDate, endDate || startDate) * perDay) : 0
  const remaining = Number(balances?.[type]) || 0
  const selectedType = types.find((t) => t.key === type)
  const period = selectedType?.period ?? 'year'

  /** Field-level validation, recomputed as the user types. */
  const errors = useMemo(() => {
    const e = {}
    const yearEnd = yearEndStr()
    if (custom) {
      if (dates.length === 0) e.dates = 'Add at least one date.'
      else if (dates.some((d) => d > yearEnd)) e.dates = 'Dates must fall within the current year.'
    } else {
      if (!startDate) e.startDate = 'Pick a start date.'
      else if (startDate > yearEnd) e.startDate = 'Dates must fall within the current year.'
      if (!endDate) e.endDate = 'Pick an end date.'
      else if (startDate && endDate < startDate) {
        e.endDate = 'The end date can’t be before the start date.'
      } else if (endDate > yearEnd) {
        e.endDate = 'Dates must fall within the current year.'
      }
    }
    if (!startTime || !endTime) e.time = 'Pick the working hours.'
    else if (
      (dayPart === 'custom' || custom || (startDate && startDate === endDate)) &&
      endTime <= startTime
    ) {
      e.time = 'The end time must be after the start time.'
    }
    // Daily-quota types are checked per date (each day's window must fit the
    // day's allowance); everything else against the whole requested amount.
    // Server-side checks are per touched period and stay authoritative.
    const requested = period === 'day' ? perDay : days
    if (days > 0 && requested > remaining) {
      e.type =
        remaining === 0
          ? `Nothing left of this leave type${period === 'year' ? '' : ` this ${period}`}.`
          : `That's ${formatLeaveAmount(period === 'day' ? perDay : days)}${period === 'day' ? ' a day' : ''}, but only ${formatLeaveAmount(remaining)} ${period === 'year' ? 'remain' : `remain this ${period}`}.`
    }
    return e
  }, [custom, dates, startDate, endDate, startTime, endTime, days, remaining, dayPart, perDay, period])

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
              const tPeriod = t.period ?? 'year'
              // A used-up daily/monthly allowance refreshes next period, so
              // only yearly types are truly unavailable at zero.
              return (
                <option key={t.key} value={t.key} disabled={left === 0 && tPeriod === 'year'}>
                  {t.label} ·{' '}
                  {left === 0 ? 'none left' : `${formatLeaveAmount(left)} left`}
                  {tPeriod === 'year' ? '' : ` this ${tPeriod}`}
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
            {formatLeaveAmount(days)} requested · {formatLeaveAmount(remaining)} available
            {period === 'year' ? '' : ` this ${period}`}
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
