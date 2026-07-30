import { useCallback, useState } from 'react'
import { useAsyncData } from '../lib/useAsyncData'
import { leaveTypes as leaveTypesApi, LEAVE_TYPES_CHANGED_EVENT } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { useToast } from '../context/ToastContext'
import Icon from './Icon'
import { Skeleton, EmptyState, InlineError } from './States'

const LABEL_MAX = 60

/**
 * Admin management of leave types (Casual, Sick, Earned, or anything custom
 * an admin adds — e.g. Bereavement Leave). Retiring one doesn't delete it:
 * historical Leave documents keep referencing its key and display fine —
 * it's just hidden from new applications (see server/routes/leaveTypes.js,
 * which only ever soft-deletes via `active`).
 */
export default function LeaveTypesManager() {
  const toast = useToast()
  const typesQ = useAsyncData(useCallback(() => leaveTypesApi.list(), []))
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editLabel, setEditLabel] = useState('')

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
      const created = await leaveTypesApi.create({ label: trimmed })
      typesQ.setData((prev) => [...(prev ?? []), created])
      window.dispatchEvent(new Event(LEAVE_TYPES_CHANGED_EVENT))
      setLabel('')
      haptic('success')
      toast.success(`"${created.label}" added.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCreating(false)
    }
  }

  function startEdit(t) {
    setEditingId(t.id)
    setEditLabel(t.label)
  }
  function cancelEdit() {
    setEditingId(null)
    setEditLabel('')
  }

  async function saveLabel(t) {
    const trimmed = editLabel.trim()
    if (!trimmed || trimmed === t.label) {
      cancelEdit()
      return
    }
    setBusyId(t.id)
    try {
      const updated = await leaveTypesApi.update(t.id, { label: trimmed })
      typesQ.setData((prev) => (prev ?? []).map((x) => (x.id === t.id ? updated : x)))
      toast.success('Renamed.')
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
        The kinds of leave employees can apply for. Retiring one keeps history intact but hides
        it from new applications.
      </p>

      <form onSubmit={create} className="leave-type-add">
        <label className="sr-only" htmlFor="lt-label">New leave type name</label>
        <input
          id="lt-label"
          value={label}
          maxLength={LABEL_MAX}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Bereavement Leave"
        />
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
                <form className="leave-type-edit" onSubmit={(e) => { e.preventDefault(); saveLabel(t) }}>
                  <input
                    value={editLabel}
                    maxLength={LABEL_MAX}
                    onChange={(e) => setEditLabel(e.target.value)}
                    autoFocus
                  />
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
                    <em>{t.active ? 'Active' : 'Retired'}</em>
                  </div>
                  <div className="team-list__actions">
                    <button type="button" className="link-btn" onClick={() => startEdit(t)}>
                      Rename
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
