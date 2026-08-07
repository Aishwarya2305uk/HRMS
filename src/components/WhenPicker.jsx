import { useState } from 'react'
import Icon from './Icon'
import { formatDate } from '../lib/format'
import { haptic } from '../lib/haptics'

/** Default working-hours windows per day part ('HH:MM', 24h). */
export const DAY_PART_TIMES = {
  full: { startTime: '09:00', endTime: '18:00' },
  first: { startTime: '09:00', endTime: '13:30' },
  second: { startTime: '13:30', endTime: '18:00' },
}

const DAY_PARTS = [
  { key: 'full', label: 'Full day' },
  { key: 'first', label: 'First half' },
  { key: 'second', label: 'Second half' },
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
 * Owns the coupling rules so both modals don't have to: picking a half day
 * snaps the times to that half's window and locks the request to a single
 * date (range mode syncs+disables the end date; custom mode is capped at
 * one chip, and adding a second one drops back to a full day).
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
  const half = dayPart !== 'full'
  const custom = mode === 'custom'
  // The date staged in the custom-mode picker before "Add" commits it.
  const [draftDate, setDraftDate] = useState('')
  // Which end of the range the user is working on — each date unlocks only
  // its own time: start date pairs with "From", end date with "To".
  const [activeEnd, setActiveEnd] = useState('start')
  const startTimeLocked = !custom && activeEnd === 'end'
  const endTimeLocked = !custom && activeEnd === 'start'

  function pickDayPart(part) {
    if (part === dayPart) return
    haptic('light')
    onChange({
      dayPart: part,
      ...DAY_PART_TIMES[part],
      ...(part !== 'full' && !custom && startDate ? { endDate: startDate } : {}),
      // A half day covers one date — in custom mode drop any extra picks.
      ...(part !== 'full' && custom && dates.length > 1 ? { dates: dates.slice(0, 1) } : {}),
    })
  }

  function pickMode(next) {
    if (next === mode) return
    haptic('light')
    onChange({ mode: next })
    markTouched('dates')
  }

  function addDraftDate() {
    if (!draftDate || dates.includes(draftDate) || dates.length >= MAX_CUSTOM_DATES) return
    haptic('light')
    const next = [...dates, draftDate].sort()
    onChange({
      dates: next,
      // More than one date can't be a half day — quietly widen back to full.
      ...(next.length > 1 && half ? { dayPart: 'full', ...DAY_PART_TIMES.full } : {}),
    })
    setDraftDate('')
    markTouched('dates')
  }

  function removeDate(d) {
    onChange({ dates: dates.filter((x) => x !== d) })
  }

  return (
    <div className="when-card">
      <div className="when-card__head">
        <span className="when-card__title">
          <Icon name="calendar" size={15} />
          Dates &amp; time
        </span>
        <div className="seg" role="group" aria-label="Day coverage">
          {DAY_PARTS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`seg__btn${dayPart === p.key ? ' is-active' : ''}`}
              aria-pressed={dayPart === p.key}
              disabled={p.key !== 'full' && custom && dates.length > 1}
              title={
                p.key !== 'full' && custom && dates.length > 1
                  ? 'Half days cover a single date — remove extra dates first.'
                  : undefined
              }
              onClick={() => pickDayPart(p.key)}
            >
              {p.label}
            </button>
          ))}
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
              disabled={!draftDate || dates.includes(draftDate) || (half && dates.length >= 1)}
            >
              <Icon name="plus" size={14} />
              Add date
            </button>
          </div>
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
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${idPrefix}-startDate`}>Start date</label>
              <input
                id={`${idPrefix}-startDate`}
                type="date"
                value={startDate}
                min={todayStr()}
                max={yearEndStr()}
                onFocus={() => setActiveEnd('start')}
                onChange={(e) => {
                  setActiveEnd('start')
                  onChange({ startDate: e.target.value, ...(half ? { endDate: e.target.value } : {}) })
                }}
                onBlur={() => markTouched('startDate')}
                aria-invalid={Boolean(showError('startDate'))}
                aria-describedby={showError('startDate') ? `err-${idPrefix}-start` : undefined}
                required
              />
              {showError('startDate') && (
                <p className="field-error" id={`err-${idPrefix}-start`}>{errors.startDate}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor={`${idPrefix}-endDate`}>End date</label>
              <input
                id={`${idPrefix}-endDate`}
                type="date"
                value={endDate}
                min={startDate || todayStr()}
                max={yearEndStr()}
                disabled={half}
                onFocus={() => setActiveEnd('end')}
                onChange={(e) => {
                  setActiveEnd('end')
                  onChange({ endDate: e.target.value })
                }}
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
          </div>
        </>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-startTime`}>From</label>
          <input
            id={`${idPrefix}-startTime`}
            type="time"
            value={startTime}
            disabled={startTimeLocked}
            title={startTimeLocked ? 'Switch to the start date to edit this time.' : undefined}
            onChange={(e) => onChange({ startTime: e.target.value })}
            onBlur={() => markTouched('time')}
            aria-invalid={Boolean(showError('time'))}
            required
          />
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-endTime`}>To</label>
          <input
            id={`${idPrefix}-endTime`}
            type="time"
            value={endTime}
            disabled={endTimeLocked}
            title={endTimeLocked ? 'Switch to the end date to edit this time.' : undefined}
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
      </div>
    </div>
  )
}
