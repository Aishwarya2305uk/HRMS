import { useCallback, useState } from 'react'
import { useAsyncData } from '../lib/useAsyncData'
import { teams as teamsApi } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { useToast } from '../context/ToastContext'
import Icon from './Icon'
import { Skeleton, EmptyState, InlineError } from './States'

const NAME_MAX = 60

/** Create/edit form — member picker is checkbox chips over the caller's own reports. */
function TeamForm({ candidates, initial, onCancel, onSaved }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [selected, setSelected] = useState(() => new Set(initial?.members?.map((m) => m.id) ?? []))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const cleanName = name.trim()
    if (!cleanName) return setError('Give the team a name.')
    if (selected.size === 0) return setError('Pick at least one team member.')

    setSaving(true)
    haptic('medium')
    try {
      const body = { name: cleanName, memberIds: [...selected] }
      const saved = initial ? await teamsApi.update(initial.id, body) : await teamsApi.create(body)
      haptic('success')
      onSaved(saved)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="team-form" noValidate>
      {error && <InlineError>{error}</InlineError>}

      <div className="field">
        <label htmlFor="team-name">Team name</label>
        <input
          id="team-name"
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project Alpha"
          autoFocus
        />
      </div>

      <div className="field">
        <label>Members</label>
        {candidates.length === 0 ? (
          <p className="field-hint">You don&apos;t have any direct or indirect reports yet.</p>
        ) : (
          <div className="team-member-picker">
            {candidates.map((c) => (
              <label key={c.id} className="team-member-option">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="modal__actions">
        <button type="button" className="btn-tactile ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn-tactile primary" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create team'}
        </button>
      </div>
    </form>
  )
}

/**
 * Self-service project-team management for managers/admins: group your own
 * reports into named teams ("Project Alpha", "Project Beta") so an
 * announcement can target one specific project instead of everyone who
 * reports to you. Membership is always validated server-side against your
 * own reporting subtree (server/routes/teams.js) — this can never reach
 * further than the "my whole team" broadcast already could.
 */
export default function TeamsManager() {
  const toast = useToast()
  const teamsQ = useAsyncData(useCallback(() => teamsApi.mine(), []))
  const candidatesQ = useAsyncData(useCallback(() => teamsApi.candidates(), []))
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const candidates = candidatesQ.data ?? []
  const list = teamsQ.data ?? []

  function openCreate() {
    setEditing(null)
    setShowForm(true)
  }
  function openEdit(team) {
    setEditing(team)
    setShowForm(true)
  }
  function closeForm() {
    setShowForm(false)
    setEditing(null)
  }

  function onSaved(team) {
    teamsQ.setData((prev) => {
      const rest = (prev ?? []).filter((t) => t.id !== team.id)
      return [...rest, team].sort((a, b) => a.name.localeCompare(b.name))
    })
    toast.success(`Team "${team.name}" saved.`)
    closeForm()
  }

  async function remove(team) {
    setBusyId(team.id)
    haptic('light')
    try {
      await teamsApi.remove(team.id)
      teamsQ.setData((prev) => (prev ?? []).filter((t) => t.id !== team.id))
      toast.success(`Team "${team.name}" removed.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  if (teamsQ.loading && teamsQ.data === null) return <Skeleton rows={2} />
  if (teamsQ.error && teamsQ.data === null) {
    return <InlineError onRetry={teamsQ.reload}>{teamsQ.error.message}</InlineError>
  }

  return (
    <section className="card pop" style={{ '--d': '40ms' }}>
      <div className="attendance__head">
        <h2>My teams</h2>
        {!showForm && (
          <button type="button" className="btn-tactile primary sm" onClick={openCreate}>
            <Icon name="plus" size={15} />
            New team
          </button>
        )}
      </div>
      <p className="field-hint team-manager__hint">
        Group your reports into named project teams so a notification can go to one specific
        team instead of everyone who reports to you.
      </p>

      {showForm && (
        <TeamForm candidates={candidates} initial={editing} onCancel={closeForm} onSaved={onSaved} />
      )}

      {!showForm && (list.length === 0 ? (
        <EmptyState
          icon="users"
          title="No teams yet"
          message="Create your first project team to target announcements more precisely."
        />
      ) : (
        <ul className="team-list">
          {list.map((t) => (
            <li key={t.id} className="team-list__item">
              <div className="team-list__text">
                <strong>{t.name}</strong>
                <em>{t.members.map((m) => m.name).join(', ') || 'No members'}</em>
              </div>
              <div className="team-list__actions">
                <button type="button" className="link-btn" onClick={() => openEdit(t)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => remove(t)}
                  disabled={busyId === t.id}
                >
                  {busyId === t.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ))}
    </section>
  )
}
