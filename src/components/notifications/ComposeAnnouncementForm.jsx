import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAsyncData } from '../../lib/useAsyncData'
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
 * and its detail ("all", "role:manager", "team:<userId>") so the UI doesn't
 * need conditional sub-pickers — it's split back apart on submit.
 */
export default function ComposeAnnouncementForm({ onCancel, onCreated }) {
  const optionsQ = useAsyncData(useCallback(() => announcementsApi.audienceOptions(), []))
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [type, setType] = useState('announcement')
  const [audience, setAudience] = useState('')
  const [touched, setTouched] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Default the "Send to" select once options arrive, without stomping a
  // choice the user already made.
  useEffect(() => {
    if (audience || !optionsQ.data) return
    if (optionsQ.data.canTargetAll) setAudience('all')
    else if (optionsQ.data.teams[0]) setAudience(`team:${optionsQ.data.teams[0].id}`)
  }, [optionsQ.data, audience])

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
      })
      haptic('success')
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
  if (optionsQ.data && !optionsQ.data.canTargetAll && optionsQ.data.teams.length === 0) {
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
        </select>
        {showError('audience') && <p className="field-error">{errors.audience}</p>}
      </div>

      <div className="modal__actions">
        <button type="button" className="btn-tactile ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn-tactile primary" disabled={submitting}>
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </form>
  )
}
