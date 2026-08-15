import { useState } from 'react'
import Icon from './Icon'
import { formatDate } from '../lib/format'
import { haptic } from '../lib/haptics'

/** Fixed working-hours windows per PRESET day part ('HH:MM', 24h). 'custom'
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
 * Day coverage comes in presets with FIXED windows (Full day / First half /
 * Second half — the times show but can't be edited, since the request's size
 * is fixed too) and 'Custom time', where both time fields unlock and the
 * picked window sets the size hours-based (8h = 1 day). A custom window may
 * span multiple dates — it applies to each one.
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
      // Presets snap to their fixed window; 'custom' keeps whatever is there
      // as the starting point for free editing.
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

  function addDraftDate() {
    if (!draftDate || dates.includes(draftDate) || dates.length >= MAX_CUSTOM_DATES) return
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
            disabled={!customTime}
            title={!customTime ? 'Fixed window — pick "Custom time" to choose your own hours.' : undefined}
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
            disabled={!customTime}
            title={!customTime ? 'Fixed window — pick "Custom time" to choose your own hours.' : undefined}
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

      <p className="field-hint">
        {customTime
          ? 'Pick any window — those hours count toward your leave, and 8h makes a full day.'
          : 'Preset windows are fixed. Choose "Custom time" to take just the hours you need.'}
      </p>
    </div>
  )
}
