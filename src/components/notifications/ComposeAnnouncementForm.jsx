import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAsyncData } from '../../lib/useAsyncData'
import { useSessionState } from '../../lib/useSessionState'
import { announcements as announcementsApi } from '../../lib/hrms'
import { haptic } from '../../lib/haptics'
import { Skeleton, EmptyState, InlineError } from '../States'

const TITLE_MAX = 140
const BODY_MAX = 2000

/**
 * Compose form for a new announcement/urgent message. Rendered as plain
 * content swapped into NotificationsPanel's drawer (not its own Modal) —
 * see that component for why two stacked dialogs would fight over Escape.
 *
 * "Send to" is a single select whose value encodes both the audience scope
 * and its detail ("all", "role:manager", "team:<userId>", "group:<teamId>")
 * so the UI doesn't need conditional sub-pickers — it's split back apart on
 * submit. "team" targets a manager's whole reporting subtree; "group"
 * targets one of their own named project teams (see TeamsManager) — finer
 * grained, for when a manager runs several projects and only wants one.
 */
export default function ComposeAnnouncementForm({ onCancel, onCreated, cancelLabel = 'Cancel' }) {
  const optionsQ = useAsyncData(useCallback(() => announcementsApi.audienceOptions(), []))
  // The draft survives a page refresh (per tab, per user — see
  // lib/useSessionState.js) and is shared by the drawer and the
  // Announcements page, so it's one draft wherever you pick it back up.
  // Posting or cancelling clears it.
  const [title, setTitle] = useSessionState('draft.announcement.title', '')
  const [body, setBody] = useSessionState('draft.announcement.body', '')
  const [type, setType] = useSessionState('draft.announcement.type', 'announcement')
  const [audience, setAudience] = useSessionState('draft.announcement.audience', '')
  const [touched, setTouched] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function clearDraft() {
    setTitle('')
    setBody('')
    setType('announcement')
    setAudience('')
  }
  function cancel() {
    clearDraft()
    onCancel()
  }

  // Default the "Send to" select once options arrive, without stomping a
  // choice the user already made — unless that (remembered) choice names an
  // audience that no longer exists, e.g. a project team deleted since.
  useEffect(() => {
    const d = optionsQ.data
    if (!d) return
    const valid = new Set([
      ...(d.canTargetAll ? ['all'] : []),
      ...(d.canTargetRole ? ['role:employee', 'role:manager', 'role:admin'] : []),
      ...d.teams.map((t) => `team:${t.id}`),
      ...(d.groups ?? []).map((g) => `group:${g.id}`),
    ])
    if (audience && !valid.has(audience)) {
      setAudience('')
      return
    }
    if (audience) return
    if (d.canTargetAll) setAudience('all')
    else if (d.teams[0]) setAudience(`team:${d.teams[0].id}`)
  }, [optionsQ.data, audience, setAudience])

  const errors = useMemo(() => {
    const e = {}
    if (!title.trim()) e.title = 'Give it a short title.'
    else if (title.length > TITLE_MAX) e.title = `Keep it under ${TITLE_MAX} characters.`
    if (!body.trim()) e.body = 'Write the message.'
    else if (body.length > BODY_MAX) e.body = `Keep it under ${BODY_MAX} characters.`
    if (!audience) e.audience = 'Choose who should see this.'
    return e
  }, [title, body, audience])
  const isValid = Object.keys(errors).length === 0
  const showError = (field) => (touched[field] || touched._submitted) && errors[field]

  function markTouched(field) {
    setTouched((t) => ({ ...t, [field]: true }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError('')
    setTouched((t) => ({ ...t, _submitted: true }))
    if (!isValid) return

    const [scope, detail] = audience.split(':')
    setSubmitting(true)
    haptic('medium')
    try {
      const created = await announcementsApi.create({
        title: title.trim(),
        body: body.trim(),
        type,
        audienceScope: scope,
        audienceRole: scope === 'role' ? detail : undefined,
        audienceRootId: scope === 'team' ? detail : undefined,
        audienceGroupId: scope === 'group' ? detail : undefined,
      })
      haptic('success')
      clearDraft()
      onCreated(created)
    } catch (err) {
      setSubmitError(err.message)
      setSubmitting(false)
    }
  }

  if (optionsQ.loading && !optionsQ.data) return <Skeleton rows={3} />
  if (optionsQ.error && !optionsQ.data) {
    return <InlineError onRetry={optionsQ.reload}>{optionsQ.error.message}</InlineError>
  }
  // `groups` defaults defensively — guards against a stale server response
  // (e.g. an old deploy) that predates this field rather than assuming it.
  const groups = optionsQ.data?.groups ?? []

  if (optionsQ.data && !optionsQ.data.canTargetAll && optionsQ.data.teams.length === 0 && groups.length === 0) {
    return (
      <EmptyState
        icon="users"
        title="No team yet"
        message="You don't have any direct reports yet, so there's no team to broadcast to."
      />
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="notif-compose">
      {submitError && <InlineError>{submitError}</InlineError>}

      <div className="field">
        <label htmlFor="an-title">Title</label>
        <input
          id="an-title"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => markTouched('title')}
          aria-invalid={Boolean(showError('title'))}
          autoFocus
        />
        {showError('title') && <p className="field-error">{errors.title}</p>}
      </div>

      <div className="field">
        <label htmlFor="an-body">Message</label>
        <textarea
          id="an-body"
          rows={4}
          value={body}
          maxLength={BODY_MAX}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => markTouched('body')}
          aria-invalid={Boolean(showError('body'))}
        />
        <p className="field-hint">{BODY_MAX - body.length} characters remaining</p>
        {showError('body') && <p className="field-error">{errors.body}</p>}
      </div>

      <div className="field">
        <label>Priority</label>
        <div className="seg" role="group" aria-label="Priority">
          <button
            type="button"
            className={`seg__btn${type === 'announcement' ? ' is-active' : ''}`}
            onClick={() => setType('announcement')}
          >
            Announcement
          </button>
          <button
            type="button"
            className={`seg__btn${type === 'urgent' ? ' is-active' : ''}`}
            onClick={() => setType('urgent')}
          >
            Urgent
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="an-audience">Send to</label>
        <select
          id="an-audience"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          onBlur={() => markTouched('audience')}
          aria-invalid={Boolean(showError('audience'))}
        >
          {optionsQ.data.canTargetAll && <option value="all">Everyone</option>}
          {optionsQ.data.canTargetRole && (
            <>
              <option value="role:employee">All employees</option>
              <option value="role:manager">All managers</option>
              <option value="role:admin">All admins</option>
            </>
          )}
          {optionsQ.data.teams.map((t) => (
            <option key={t.id} value={`team:${t.id}`}>
              {t.label} ({t.size})
            </option>
          ))}
          {groups.length > 0 && (
            <optgroup label="My project teams">
              {groups.map((g) => (
                <option key={g.id} value={`group:${g.id}`}>
                  {g.name} ({g.size})
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {showError('audience') && <p className="field-error">{errors.audience}</p>}
      </div>

      <div className="modal__actions">
        <button type="button" className="btn-tactile ghost" onClick={cancel} disabled={submitting}>
          {cancelLabel}
        </button>
        <button type="submit" className="btn-tactile primary" disabled={submitting}>
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </form>
  )
}
