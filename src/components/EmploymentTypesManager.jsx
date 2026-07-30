import { useCallback, useEffect, useState } from 'react'
import { useAsyncData } from '../lib/useAsyncData'
import { employmentTypes as employmentTypesApi, leaves as leavesApi, LEAVE_TYPES_CHANGED_EVENT } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { useToast } from '../context/ToastContext'
import Icon from './Icon'
import { Skeleton, EmptyState, InlineError } from './States'

const NAME_MAX = 60

/**
 * Admin management of employment types (Intern, Full-time, Part-time, or any
 * custom classification) and how many days of each active leave type someone
 * on that classification is granted.
 *
 * Editing quotas here is deliberately NOT retroactive: User.leaveQuotas is a
 * frozen snapshot taken when someone is assigned (see server/models/User.js)
 * — changing a policy's numbers only affects people assigned to it
 * afterward, never anyone already hired under the old ones.
 */
export default function EmploymentTypesManager() {
  const toast = useToast()
  const typesQ = useAsyncData(useCallback(() => employmentTypesApi.list(), []))
  const leaveTypesQ = useAsyncData(useCallback(() => leavesApi.config(), []))
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState(null)
  // { [employmentTypeId]: { [leaveTypeKey]: string } } — only populated once
  // someone actually edits a field; read through draftFor() otherwise.
  const [drafts, setDrafts] = useState({})

  const types = typesQ.data ?? []
  const leaveTypeList = leaveTypesQ.data?.types ?? []

  // LeaveTypesManager renders alongside this component on the same page but
  // fetches independently — pick up its changes without needing a reload.
  const reloadLeaveTypes = leaveTypesQ.reload
  useEffect(() => {
    window.addEventListener(LEAVE_TYPES_CHANGED_EVENT, reloadLeaveTypes)
    return () => window.removeEventListener(LEAVE_TYPES_CHANGED_EVENT, reloadLeaveTypes)
  }, [reloadLeaveTypes])

  function draftFor(et) {
    return drafts[et.id] ?? Object.fromEntries(leaveTypeList.map((lt) => [lt.key, String(et.quotas?.[lt.key] ?? 0)]))
  }
  function setDraftValue(et, key, value) {
    setDrafts((prev) => ({ ...prev, [et.id]: { ...draftFor(et), [key]: value } }))
  }

  async function create(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed.length > NAME_MAX) {
      toast.error(`Keep it under ${NAME_MAX} characters.`)
      return
    }
    setCreating(true)
    haptic('medium')
    try {
      const created = await employmentTypesApi.create({ name: trimmed })
      typesQ.setData((prev) => [...(prev ?? []), created])
      setName('')
      haptic('success')
      toast.success(`"${created.name}" added.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function saveQuotas(et) {
    const draft = draftFor(et)
    const quotas = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, Math.max(0, Number(v) || 0)]),
    )
    setBusyId(et.id)
    haptic('medium')
    try {
      const updated = await employmentTypesApi.update(et.id, { quotas })
      typesQ.setData((prev) => (prev ?? []).map((x) => (x.id === et.id ? updated : x)))
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[et.id]
        return next
      })
      haptic('success')
      toast.success(`"${et.name}" policy updated — only future assignments are affected.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function remove(et) {
    setBusyId(et.id)
    haptic('light')
    try {
      await employmentTypesApi.remove(et.id)
      typesQ.setData((prev) => (prev ?? []).filter((x) => x.id !== et.id))
      toast.success(`"${et.name}" removed.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  if ((typesQ.loading && typesQ.data === null) || (leaveTypesQ.loading && leaveTypesQ.data === null)) {
    return <Skeleton rows={3} />
  }
  if (typesQ.error && typesQ.data === null) {
    return <InlineError onRetry={typesQ.reload}>{typesQ.error.message}</InlineError>
  }

  return (
    <section className="card pop" style={{ '--d': '120ms' }}>
      <div className="attendance__head">
        <h2>Employment types</h2>
      </div>
      <p className="field-hint team-manager__hint">
        How many days of each leave type someone on a given employment classification is
        granted. Changing a quota only affects people assigned to it afterward.
      </p>

      <form onSubmit={create} className="leave-type-add">
        <label className="sr-only" htmlFor="et-name">New employment type name</label>
        <input
          id="et-name"
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Contractor"
        />
        <button type="submit" className="btn-tactile primary sm" disabled={creating || !name.trim()}>
          <Icon name="plus" size={15} />
          {creating ? 'Adding…' : 'Add'}
        </button>
      </form>

      {types.length === 0 ? (
        <EmptyState
          icon="users"
          title="No employment types yet"
          message="Add one above to get started."
        />
      ) : (
        <ul className="employment-type-list">
          {types.map((et) => {
            const draft = draftFor(et)
            const busy = busyId === et.id
            return (
              <li key={et.id} className="employment-type-card">
                <div className="employment-type-card__head">
                  <strong>{et.name}</strong>
                  <button
                    type="button"
                    className="icon-btn sm"
                    onClick={() => remove(et)}
                    disabled={busy}
                    aria-label={`Remove ${et.name}`}
                    title="Remove"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>

                {leaveTypeList.length === 0 ? (
                  <p className="field-hint">Add a leave type above to set quotas.</p>
                ) : (
                  <div className="employment-type-card__quotas">
                    {leaveTypeList.map((lt) => (
                      <label key={lt.key} className="employment-type-quota">
                        <span>{lt.label}</span>
                        <input
                          type="number"
                          min="0"
                          value={draft[lt.key] ?? '0'}
                          onChange={(e) => setDraftValue(et, lt.key, e.target.value)}
                          disabled={busy}
                        />
                      </label>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className="btn-tactile primary sm"
                  onClick={() => saveQuotas(et)}
                  disabled={busy || leaveTypeList.length === 0}
                >
                  {busy ? 'Saving…' : 'Save quotas'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
