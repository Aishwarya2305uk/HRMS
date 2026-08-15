import { useCallback, useState } from 'react'
import { useAsyncData } from '../lib/useAsyncData'
import { leaveTypes as leaveTypesApi, LEAVE_TYPES_CHANGED_EVENT } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { useToast } from '../context/ToastContext'
import Icon from './Icon'
import { Skeleton, EmptyState, InlineError } from './States'

const LABEL_MAX = 60

const UNITS = [
  { key: 'days', label: 'Days' },
  { key: 'hours', label: 'Hours' },
]
const PERIODS = [
  { key: 'year', label: 'per year' },
  { key: 'month', label: 'per month' },
  { key: 'day', label: 'per day' },
]

/** "days per year" / "hours per day" — how a type's quota numbers read. */
const policyLabel = (t) => `${t.unit ?? 'days'} ${PERIODS.find((p) => p.key === (t.period ?? 'year'))?.label ?? 'per year'}`

/**
 * Admin management of leave types (Casual, Sick, Earned, or anything custom
 * an admin adds — e.g. Bereavement Leave), including each type's POLICY
 * SHAPE: whether its quota is counted in days or hours, and whether the
 * allowance is per year (a stored balance), per month or per day (resets
 * each period). The amounts themselves live on the employment-type matrix
 * next to this card. Retiring a type doesn't delete it: historical Leave
 * documents keep referencing its key and display fine — it's just hidden
 * from new applications (see server/routes/leaveTypes.js, which only ever
 * soft-deletes via `active`).
 */
export default function LeaveTypesManager() {
  const toast = useToast()
  const typesQ = useAsyncData(useCallback(() => leaveTypesApi.list(), []))
  const [label, setLabel] = useState('')
  const [unit, setUnit] = useState('days')
  const [period, setPeriod] = useState('year')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState({ label: '', unit: 'days', period: 'year' })

  const types = typesQ.data ?? []

  async function create(e) {
    e.preventDefault()
    const trimmed = label.trim()
    if (!trimmed) return
    if (trimmed.length > LABEL_MAX) {
      toast.error(`Keep it under ${LABEL_MAX} characters.`)
      return
    }
    setCreating(true)
    haptic('medium')
    try {
      const created = await leaveTypesApi.create({ label: trimmed, unit, period })
      typesQ.setData((prev) => [...(prev ?? []), created])
      window.dispatchEvent(new Event(LEAVE_TYPES_CHANGED_EVENT))
      setLabel('')
      setUnit('days')
      setPeriod('year')
      haptic('success')
      toast.success(`"${created.label}" added — quotas count in ${policyLabel(created)}.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCreating(false)
    }
  }

  function startEdit(t) {
    setEditingId(t.id)
    setDraft({ label: t.label, unit: t.unit ?? 'days', period: t.period ?? 'year' })
  }
  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(t) {
    const trimmed = draft.label.trim()
    if (!trimmed) {
      cancelEdit()
      return
    }
    const unchanged =
      trimmed === t.label && draft.unit === (t.unit ?? 'days') && draft.period === (t.period ?? 'year')
    if (unchanged) {
      cancelEdit()
      return
    }
    setBusyId(t.id)
    try {
      const updated = await leaveTypesApi.update(t.id, {
        label: trimmed,
        unit: draft.unit,
        period: draft.period,
      })
      typesQ.setData((prev) => (prev ?? []).map((x) => (x.id === t.id ? updated : x)))
      window.dispatchEvent(new Event(LEAVE_TYPES_CHANGED_EVENT))
      toast.success('Saved.')
      cancelEdit()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function toggleActive(t) {
    setBusyId(t.id)
    haptic('light')
    try {
      const updated = await leaveTypesApi.update(t.id, { active: !t.active })
      typesQ.setData((prev) => (prev ?? []).map((x) => (x.id === t.id ? updated : x)))
      window.dispatchEvent(new Event(LEAVE_TYPES_CHANGED_EVENT))
      toast.success(updated.active ? `"${t.label}" reactivated.` : `"${t.label}" retired.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  if (typesQ.loading && typesQ.data === null) return <Skeleton rows={2} />
  if (typesQ.error && typesQ.data === null) {
    return <InlineError onRetry={typesQ.reload}>{typesQ.error.message}</InlineError>
  }

  return (
    <section className="card pop" style={{ '--d': '40ms' }}>
      <div className="attendance__head">
        <h2>Leave types</h2>
      </div>
      <p className="field-hint team-manager__hint">
        The kinds of leave employees can apply for, and how each one&rsquo;s policy counts —
        so a quota reads &ldquo;x days per year&rdquo; or &ldquo;x hours per day&rdquo;. Amounts are set on the
        employment types below; 8 hours make 1 day. Retiring a type keeps history intact but
        hides it from new applications.
      </p>

      <form onSubmit={create} className="leave-type-add leave-type-add--policy">
        <label className="sr-only" htmlFor="lt-label">New leave type name</label>
        <input
          id="lt-label"
          value={label}
          maxLength={LABEL_MAX}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Short Permission"
        />
        <label className="sr-only" htmlFor="lt-unit">Quota unit</label>
        <select
          id="lt-unit"
          className="policy-select"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        >
          {UNITS.map((u) => (
            <option key={u.key} value={u.key}>{u.label}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="lt-period">Quota period</label>
        <select
          id="lt-period"
          className="policy-select"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
        <button type="submit" className="btn-tactile primary sm" disabled={creating || !label.trim()}>
          <Icon name="plus" size={15} />
          {creating ? 'Adding…' : 'Add'}
        </button>
      </form>

      {types.length === 0 ? (
        <EmptyState icon="leaf" title="No leave types yet" message="Add one above to get started." />
      ) : (
        <ul className="team-list">
          {types.map((t) => (
            <li key={t.id} className={`team-list__item${t.active ? '' : ' is-inactive'}`}>
              {editingId === t.id ? (
                <form className="leave-type-edit" onSubmit={(e) => { e.preventDefault(); saveEdit(t) }}>
                  <input
                    value={draft.label}
                    maxLength={LABEL_MAX}
                    onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                    autoFocus
                  />
                  <select
                    className="policy-select"
                    value={draft.unit}
                    onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
                    aria-label="Quota unit"
                  >
                    {UNITS.map((u) => (
                      <option key={u.key} value={u.key}>{u.label}</option>
                    ))}
                  </select>
                  <select
                    className="policy-select"
                    value={draft.period}
                    onChange={(e) => setDraft((d) => ({ ...d, period: e.target.value }))}
                    aria-label="Quota period"
                  >
                    {PERIODS.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                  <button type="submit" className="btn-tactile primary sm" disabled={busyId === t.id}>
                    Save
                  </button>
                  <button type="button" className="btn-tactile ghost sm" onClick={cancelEdit}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <div className="team-list__text">
                    <strong>{t.label}</strong>
                    <em>{t.active ? 'Active' : 'Retired'} · {policyLabel(t)}</em>
                  </div>
                  <div className="team-list__actions">
                    <button type="button" className="link-btn" onClick={() => startEdit(t)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => toggleActive(t)}
                      disabled={busyId === t.id}
                    >
                      {busyId === t.id ? 'Saving…' : t.active ? 'Retire' : 'Reactivate'}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
