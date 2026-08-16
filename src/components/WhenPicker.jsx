import { useState } from 'react'
import Icon from './Icon'
import { formatDate } from '../lib/format'
import { haptic } from '../lib/haptics'
import { isWeeklyOff } from '../lib/leave'

/** Usual working-hours windows per PRESET day part ('HH:MM', 24h) — what a
 *  preset PREFILLS into the (always editable) time fields. 'custom'
 *  deliberately has no entry — its whole point is a freely-picked window. */
export const DAY_PART_TIMES = {
  full: { startTime: '09:00', endTime: '18:00' },
  first: { startTime: '09:00', endTime: '13:30' },
  second: { startTime: '13:30', endTime: '18:00' },
}

const DAY_PARTS = [
  { key: 'full', label: 'Full day' },
  { key: 'first', label: 'First half' },
  { key: 'second', label: 'Second half' },
  { key: 'custom', label: 'Custom time' },
]

const MODES = [
  { key: 'range', label: 'Date range' },
  { key: 'custom', label: 'Custom dates' },
]

export const MAX_CUSTOM_DATES = 31

const todayStr = () => new Date().toISOString().slice(0, 10)

/** Last selectable day — leave/WFH requests are limited to the current year. */
export const yearEndStr = () => `${new Date().getFullYear()}-12-31`

/**
 * The "when" card shared by the leave and WFH apply modals: a working-hours
 * window plus either a start–end DATE RANGE or CUSTOM DATES — individually
 * picked days that don't have to be consecutive (the server files one
 * request per consecutive run).
 *
 * Laid out as the request reads: Start date beside Start time, then End
 * date beside End time (custom-dates mode: the date list, then the two
 * times). The time fields are ALWAYS editable. Day coverage presets (Full
 * day / First half / Second half) prefill their usual hours as a starting
 * point and fix the AMOUNT (1 or 0.5 day per date) — the times then simply
 * record when the leave starts and ends, and the server accepts any valid
 * pair for them. 'Custom time' instead sizes the request by the picked
 * window, hours-based (8h = 1 day); that window may span multiple dates —
 * it applies to each one.
 *
 * Owns the coupling rules so both modals don't have to: picking a HALF day
 * locks the request to a single date (range mode syncs+disables the end
 * date; custom-dates mode is capped at one chip).
 *
 * State stays in the parent — this only renders `value` and reports patches.
 *
 * @param {string}   props.idPrefix  'lv' | 'wfh' — namespaces input ids for labels/focus
 * @param {object}   props.value     { mode, startDate, endDate, dates, dayPart, startTime, endTime }
 * @param {Function} props.onChange  (patch) => void — partial update to merge
 * @param {Function} props.showError (field) => truthy when the field's error should show
 * @param {object}   props.errors    field -> message
 * @param {Function} props.markTouched (field) => void
 */
export default function WhenPicker({ idPrefix, value, onChange, showError, errors, markTouched }) {
  const { mode = 'range', startDate, endDate, dates = [], dayPart, startTime, endTime } = value
  // Halves cover a single date; 'custom' behaves like 'full' for dates.
  const half = dayPart === 'first' || dayPart === 'second'
  const customTime = dayPart === 'custom'
  const custom = mode === 'custom'
  // The date staged in the custom-mode picker before "Add" commits it.
  const [draftDate, setDraftDate] = useState('')

  function pickDayPart(part) {
    if (part === dayPart) return
    haptic('light')
    const isHalf = part === 'first' || part === 'second'
    onChange({
      dayPart: part,
      // Presets prefill their usual hours (still editable afterwards);
      // 'custom' keeps whatever is there as the starting point.
      ...(DAY_PART_TIMES[part] ?? {}),
      ...(isHalf && !custom && startDate ? { endDate: startDate } : {}),
      // A half day covers one date — in custom mode drop any extra picks.
      ...(isHalf && custom && dates.length > 1 ? { dates: dates.slice(0, 1) } : {}),
    })
  }

  function pickMode(next) {
    if (next === mode) return
    haptic('light')
    onChange({ mode: next })
    markTouched('dates')
  }

  // Sundays are weekly offs — nothing to request (the server refuses too).
  const draftIsWeeklyOff = isWeeklyOff(draftDate)

  function addDraftDate() {
    if (!draftDate || draftIsWeeklyOff || dates.includes(draftDate) || dates.length >= MAX_CUSTOM_DATES) return
    haptic('light')
    const next = [...dates, draftDate].sort()
    onChange({
      dates: next,
      // More than one date can't be a HALF day — quietly widen back to full.
      // (A custom window is fine across many dates: it applies to each.)
      ...(next.length > 1 && half ? { dayPart: 'full', ...DAY_PART_TIMES.full } : {}),
    })
    setDraftDate('')
    markTouched('dates')
  }

  function removeDate(d) {
    onChange({ dates: dates.filter((x) => x !== d) })
  }

  // The two time fields, always editable whatever the day part (presets only
  // PREFILL them). Rendered beside their date in range mode and side by side
  // in custom-dates mode, so they're built once here. The shared `time`
  // error sits under End time, the field that completes the window.
  const startTimeField = (
    <div className="field">
      <label htmlFor={`${idPrefix}-startTime`}>Start time</label>
      <input
        id={`${idPrefix}-startTime`}
        type="time"
        value={startTime}
        onChange={(e) => onChange({ startTime: e.target.value })}
        onBlur={() => markTouched('time')}
        aria-invalid={Boolean(showError('time'))}
        required
      />
    </div>
  )
  const endTimeField = (
    <div className="field">
      <label htmlFor={`${idPrefix}-endTime`}>End time</label>
      <input
        id={`${idPrefix}-endTime`}
        type="time"
        value={endTime}
        onChange={(e) => onChange({ endTime: e.target.value })}
        onBlur={() => markTouched('time')}
        aria-invalid={Boolean(showError('time'))}
        aria-describedby={showError('time') ? `err-${idPrefix}-time` : undefined}
        required
      />
      {showError('time') && (
        <p className="field-error" id={`err-${idPrefix}-time`}>{errors.time}</p>
      )}
    </div>
  )

  return (
    <div className="when-card">
      <div className="when-card__head">
        <span className="when-card__title">
          <Icon name="calendar" size={15} />
          Dates &amp; time
        </span>
        <div className="seg" role="group" aria-label="Day coverage">
          {DAY_PARTS.map((p) => {
            const halfBlocked =
              (p.key === 'first' || p.key === 'second') && custom && dates.length > 1
            return (
              <button
                key={p.key}
                type="button"
                className={`seg__btn${dayPart === p.key ? ' is-active' : ''}`}
                aria-pressed={dayPart === p.key}
                disabled={halfBlocked}
                title={
                  halfBlocked
                    ? 'Half days cover a single date — remove extra dates first.'
                    : undefined
                }
                onClick={() => pickDayPart(p.key)}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Range vs individually-picked days. */}
      <div className="seg when-card__mode" role="group" aria-label="How to pick dates">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`seg__btn${mode === m.key ? ' is-active' : ''}`}
            aria-pressed={mode === m.key}
            onClick={() => pickMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="field-hint">
        Sundays are weekly offs — they aren’t counted, and a request can’t start or end on one.
      </p>

      {custom ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-draftDate`}>
            Dates <span className="field-optional">(they don’t have to be consecutive)</span>
          </label>
          <div className="when-custom__add">
            <input
              id={`${idPrefix}-draftDate`}
              type="date"
              value={draftDate}
              min={todayStr()}
              max={yearEndStr()}
              onChange={(e) => setDraftDate(e.target.value)}
              aria-invalid={Boolean(showError('dates'))}
              aria-describedby={showError('dates') ? `err-${idPrefix}-dates` : undefined}
            />
            <button
              type="button"
              className="btn-tactile ghost sm"
              onClick={addDraftDate}
              disabled={
                !draftDate || draftIsWeeklyOff || dates.includes(draftDate) || (half && dates.length >= 1)
              }
              title={draftIsWeeklyOff ? 'Sundays are weekly offs.' : undefined}
            >
              <Icon name="plus" size={14} />
              Add date
            </button>
          </div>
          {draftIsWeeklyOff && (
            <p className="field-error" role="status">
              {formatDate(draftDate, true)} is a Sunday — a weekly off, so there’s no leave to take.
            </p>
          )}
          {dates.length > 0 && (
            <ul className="when-chips">
              {dates.map((d) => (
                <li key={d} className="when-chip">
                  {formatDate(d, true)}
                  <button
                    type="button"
                    className="when-chip__remove"
                    onClick={() => removeDate(d)}
                    aria-label={`Remove ${formatDate(d, true)}`}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {showError('dates') ? (
            <p className="field-error" id={`err-${idPrefix}-dates`}>{errors.dates}</p>
          ) : (
            <p className="field-hint">
              Consecutive dates are combined; separate blocks are filed as separate requests.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Start date beside start time … */}
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${idPrefix}-startDate`}>Start date</label>
              <input
                id={`${idPrefix}-startDate`}
                type="date"
                value={startDate}
                min={todayStr()}
                max={yearEndStr()}
                onChange={(e) =>
                  onChange({ startDate: e.target.value, ...(half ? { endDate: e.target.value } : {}) })
                }
                onBlur={() => markTouched('startDate')}
                aria-invalid={Boolean(showError('startDate'))}
                aria-describedby={showError('startDate') ? `err-${idPrefix}-start` : undefined}
                required
              />
              {showError('startDate') && (
                <p className="field-error" id={`err-${idPrefix}-start`}>{errors.startDate}</p>
              )}
            </div>
            {startTimeField}
          </div>

          {/* … then end date beside end time. */}
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${idPrefix}-endDate`}>End date</label>
              <input
                id={`${idPrefix}-endDate`}
                type="date"
                value={endDate}
                min={startDate || todayStr()}
                max={yearEndStr()}
                disabled={half}
                onChange={(e) => onChange({ endDate: e.target.value })}
                onBlur={() => markTouched('endDate')}
                aria-invalid={Boolean(showError('endDate'))}
                aria-describedby={showError('endDate') ? `err-${idPrefix}-end` : undefined}
                required
              />
              {half && <p className="field-hint">Half days cover a single date.</p>}
              {showError('endDate') && (
                <p className="field-error" id={`err-${idPrefix}-end`}>{errors.endDate}</p>
              )}
            </div>
            {endTimeField}
          </div>
        </>
      )}

      {/* Custom-dates mode has no start/end date to pair the times with, so
          they share one row under the date list. */}
      {custom && (
        <div className="field-row">
          {startTimeField}
          {endTimeField}
        </div>
      )}

      <p className="field-hint">
        {customTime
          ? 'Your hours set the amount — 8h counts as a full day — and this window applies to each date you pick.'
          : half
            ? 'A half day always counts as 0.5 day; the times just record when it starts and ends — adjust them if yours differ.'
            : 'A full day always counts as 1 day per date; the times just record when your leave starts and ends — adjust them if yours differ. Choose "Custom time" to take only the hours you need.'}
      </p>
    </div>
  )
}
