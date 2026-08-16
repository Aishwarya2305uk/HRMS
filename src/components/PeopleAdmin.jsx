import { useCallback, useMemo, useState } from 'react'
import Icon from './Icon'
import Avatar from './Avatar'
import Modal from './Modal'
import { useAuth } from '../context/AuthContext'
import { employees as employeesApi, employmentTypes as employmentTypesApi } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { formatDate } from '../lib/format'
import { useAsyncData } from '../lib/useAsyncData'
import { useSessionState } from '../lib/useSessionState'
import { useToast } from '../context/ToastContext'
import { EmptyState, InlineError } from './States'

const BLANK = {
  name: '',
  email: '',
  role: 'employee',
  designation: '',
  department: '',
  joiningDate: '',
  managerId: '',
  employmentType: '',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The link an invited person opens to finish their account (SignUp page). */
const inviteUrl = (token) => `${window.location.origin}/signup?token=${encodeURIComponent(token)}`

/**
 * Admin people management: add an employee (assigning their manager, which is
 * what wires the org tree) and view/edit everyone.
 *
 * UX approach:
 *  - Per-field validation with messages under the offending field.
 *  - Manager changes are optimistic but roll back visibly if the server
 *    rejects them, so the table never shows a change that didn't persist.
 *
 * `searchQuery` filters only the roster table below — the manager-assignment
 * dropdowns always see the full list of manager/admin candidates, regardless
 * of the search filter.
 */
export default function PeopleAdmin({ people, setPeople, searchQuery = '', onViewProfile }) {
  const toast = useToast()
  const { user: currentUser } = useAuth()
  const employmentTypesQ = useAsyncData(useCallback(() => employmentTypesApi.list(), []))
  const employmentTypeOptions = employmentTypesQ.data ?? []
  // A half-filled "add employee" form survives a page refresh (per tab, per
  // user — lib/useSessionState.js); a successful add resets it to BLANK.
  const [form, setForm] = useSessionState('draft.addEmployee', BLANK)
  const [touched, setTouched] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyManagerId, setBusyManagerId] = useState(null)
  const [busyRoleId, setBusyRoleId] = useState(null)
  /** { id, kind: 'link' | 'email' } — which roster invite action is in flight. */
  const [busyInvite, setBusyInvite] = useState(null)
  /**
   * { name, email, url, emailSent, note } — shows the copy-the-invite-link
   * dialog after add / re-invite (and as the fallback when a resend email
   * couldn't go out; `note` explains why the dialog appeared).
   */
  const [inviteModal, setInviteModal] = useState(null)
  const [inviteCopied, setInviteCopied] = useState(false)

  // Only managers/admins can be someone's "reports to" — an employee can't.
  const managerCandidates = useMemo(
    () => people.filter((p) => p.role === 'manager' || p.role === 'admin'),
    [people],
  )

  const errors = useMemo(() => {
    const e = {}
    if (!form.name.trim()) e.name = 'Enter the employee’s full name.'
    if (!form.email.trim()) e.email = 'Enter a work email.'
    else if (!EMAIL_RE.test(form.email.trim())) e.email = 'That doesn’t look like a valid email.'
    else if (people.some((p) => p.email?.toLowerCase() === form.email.trim().toLowerCase())) {
      e.email = 'Someone already uses that email.'
    }
    return e
  }, [form, people])

  const filteredPeople = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return people
    return people.filter((p) =>
      [p.name, p.email, p.designation, p.department].some((f) => f?.toLowerCase().includes(q)),
    )
  }, [people, searchQuery])

  const isValid = Object.keys(errors).length === 0
  const showError = (f) => (touched[f] || touched._submitted) && errors[f]

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }
  function markTouched(f) {
    setTouched((t) => ({ ...t, [f]: true }))
  }

  async function addEmployee(e) {
    e.preventDefault()
    setSubmitError('')
    setTouched((t) => ({ ...t, _submitted: true }))
    if (!isValid) {
      const firstBad = ['name', 'email'].find((f) => errors[f])
      document.getElementById(`emp-${firstBad}`)?.focus()
      return
    }

    setSaving(true)
    haptic('medium')
    try {
      const created = await employeesApi.add({
        ...form,
        managerId: form.managerId || null,
        employmentType: form.employmentType || null,
      })
      const managerName = people.find((p) => p.id === form.managerId)?.name ?? null
      setPeople([...people, { ...created, managerName }])
      setForm(BLANK)
      setTouched({})
      haptic('success')
      toast.success(`Invite sent — ${created.name} can now register.`)
      // The raw token exists only in this response — hand the admin the link
      // to share right away (a fresh one can be issued from the roster later).
      setInviteCopied(false)
      setInviteModal({
        name: created.name,
        email: created.email,
        url: inviteUrl(created.inviteToken),
        emailSent: Boolean(created.inviteEmailSent),
      })
    } catch (err) {
      setSubmitError(err.message)
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  /**
   * Promote/demote in place — optimistic like changeManager, with a visible
   * rollback. The server enforces the real rules (no self-change; demotion
   * blocked while the person still has direct reports) and its 409 message
   * tells the admin exactly what to fix, so we just surface it.
   */
  async function changeRole(id, role) {
    const previous = people
    const person = people.find((p) => p.id === id)
    const article = role === 'admin' ? 'an admin' : role === 'manager' ? 'a manager' : 'an employee'
    setBusyRoleId(id)
    haptic('light')
    setPeople(people.map((p) => (p.id === id ? { ...p, role } : p)))
    try {
      await employeesApi.setRole(id, role)
      toast.success(`${person?.name} is now ${article}.`)
    } catch (err) {
      setPeople(previous) // visible rollback — never show unsaved state as saved
      toast.error(`Couldn't change role — ${err.message}`)
    } finally {
      setBusyRoleId(null)
    }
  }

  /**
   * Fresh invite link for a pending account — the original token is shown
   * only once at creation, so this is how a lost/expired link is replaced.
   * The server refuses it for accounts that already registered. (Issuing a
   * link also emails it when SMTP is set up — the dialog says so — because
   * every issue rotates the token, and the newest email must always hold the
   * link that actually works.)
   */
  async function regenerateInviteLink(person) {
    setBusyInvite({ id: person.id, kind: 'link' })
    haptic('light')
    try {
      const { inviteToken, inviteEmailSent } = await employeesApi.reinvite(person.id)
      setInviteCopied(false)
      setInviteModal({
        name: person.name,
        email: person.email,
        url: inviteUrl(inviteToken),
        emailSent: Boolean(inviteEmailSent),
      })
    } catch (err) {
      toast.error(`Couldn't create an invite link — ${err.message}`)
    } finally {
      setBusyInvite(null)
    }
  }

  /**
   * "Resend": email a fresh invite in one click — no dialog to click through
   * when it goes out. Same rotate-and-send call as the link button; the
   * difference is what the admin sees afterwards. If the mail didn't go out
   * (SMTP unset or unreachable) the link dialog opens instead, with a note
   * saying why, so they can still share it themselves.
   */
  async function resendInviteEmail(person) {
    setBusyInvite({ id: person.id, kind: 'email' })
    haptic('light')
    try {
      const { inviteToken, inviteEmailSent } = await employeesApi.reinvite(person.id)
      if (inviteEmailSent) {
        haptic('success')
        toast.success(`Invite email resent to ${person.email}.`)
        return
      }
      setInviteCopied(false)
      setInviteModal({
        name: person.name,
        email: person.email,
        url: inviteUrl(inviteToken),
        emailSent: false,
        note: `The email to ${person.email} couldn’t be sent (email delivery isn’t set up or the mail server didn’t respond). Share this fresh link with ${person.name} yourself instead.`,
      })
    } catch (err) {
      toast.error(`Couldn't resend the invite — ${err.message}`)
    } finally {
      setBusyInvite(null)
    }
  }

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(inviteModal.url)
      setInviteCopied(true)
      haptic('success')
    } catch {
      toast.error('Couldn’t copy automatically — select the link and copy it manually.')
    }
  }

  async function changeManager(id, managerId) {
    const previous = people
    const person = people.find((p) => p.id === id)
    const managerName = people.find((p) => p.id === managerId)?.name ?? null
    setBusyManagerId(id)
    haptic('light')
    // Optimistic: the table updates instantly, then reverts if the server says no.
    setPeople(people.map((p) => (p.id === id ? { ...p, managerId: managerId || null, managerName } : p)))
    try {
      await employeesApi.setManager(id, managerId || null)
      toast.success(
        managerName
          ? `${person?.name} now reports to ${managerName}.`
          : `${person?.name} is now top level.`,
      )
    } catch (err) {
      setPeople(previous) // visible rollback — never show unsaved state as saved
      toast.error(`Couldn't update manager — ${err.message}`)
    } finally {
      setBusyManagerId(null)
    }
  }

  return (
    <div className="people">
      <section className="card pop" style={{ '--d': '80ms' }}>
        <div className="attendance__head">
          <h2>Add employee</h2>
        </div>

        {submitError && <InlineError>{submitError}</InlineError>}

        <form onSubmit={addEmployee} className="add-form" noValidate>
          <div className="field-row">
            <div className="field">
              <label htmlFor="emp-name">Full name</label>
              <input
                id="emp-name"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                onBlur={() => markTouched('name')}
                aria-invalid={Boolean(showError('name'))}
                aria-describedby={showError('name') ? 'err-name' : undefined}
                placeholder="Jane Doe"
              />
              {showError('name') && <p className="field-error" id="err-name">{errors.name}</p>}
            </div>
            <div className="field">
              <label htmlFor="emp-email">Work email</label>
              <input
                id="emp-email"
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                onBlur={() => markTouched('email')}
                aria-invalid={Boolean(showError('email'))}
                aria-describedby={showError('email') ? 'err-email' : undefined}
                placeholder="jane@trula.com"
              />
              {showError('email') && <p className="field-error" id="err-email">{errors.email}</p>}
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="emp-role">Role</label>
              <select id="emp-role" value={form.role} onChange={(e) => update('role', e.target.value)}>
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
              <p className="field-hint">
                {form.role === 'admin'
                  ? 'Admins can add people and see all company data.'
                  : form.role === 'manager'
                    ? 'Managers can approve leave for their direct reports.'
                    : 'Employees can log attendance and apply for leave.'}
              </p>
            </div>
            <div className="field">
              <label>Password</label>
              <p className="field-hint" style={{ marginTop: 8 }}>
                No password needed — adding someone sends an invite, and they set their own
                password when they register through the invite link.
              </p>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="emp-designation">
                Designation <span className="field-optional">(optional)</span>
              </label>
              <input
                id="emp-designation"
                value={form.designation}
                onChange={(e) => update('designation', e.target.value)}
                placeholder="Software Engineer"
              />
            </div>
            <div className="field">
              <label htmlFor="emp-department">
                Department <span className="field-optional">(optional)</span>
              </label>
              <input
                id="emp-department"
                value={form.department}
                onChange={(e) => update('department', e.target.value)}
                placeholder="Engineering"
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="emp-joining">
                Joining date <span className="field-optional">(optional)</span>
              </label>
              <input
                id="emp-joining"
                type="date"
                value={form.joiningDate}
                onChange={(e) => update('joiningDate', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="emp-employmentType">
                Employment type <span className="field-optional">(optional)</span>
              </label>
              <select
                id="emp-employmentType"
                value={form.employmentType}
                onChange={(e) => update('employmentType', e.target.value)}
              >
                <option value="">— None —</option>
                {employmentTypeOptions.map((et) => (
                  <option key={et.id} value={et.id}>{et.name}</option>
                ))}
              </select>
              <p className="field-hint">
                Sets their leave policy — manage these under Leave Policies.
              </p>
            </div>
          </div>

          <div className="field">
            <label htmlFor="emp-manager">Reports to</label>
            <select
              id="emp-manager"
              value={form.managerId}
              onChange={(e) => update('managerId', e.target.value)}
            >
              <option value="">— No manager (top level) —</option>
              {managerCandidates.map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {p.role}</option>
              ))}
            </select>
            <p className="field-hint">This is what builds the organization tree.</p>
          </div>

          <button type="submit" className="btn-tactile primary" disabled={saving}>
            <Icon name="plus" size={18} />
            {saving ? 'Adding…' : 'Add employee'}
          </button>
        </form>
      </section>

      <section className="card pop" style={{ '--d': '160ms' }}>
        <div className="attendance__head">
          <h2>All employees</h2>
          <span className="count-pill">{people.length}</span>
        </div>

        {people.length === 0 ? (
          <EmptyState
            icon="users"
            title="No employees yet"
            message="Add your first employee using the form above."
          />
        ) : filteredPeople.length === 0 ? (
          <EmptyState
            icon="users"
            title="No matches"
            message={`Nobody matches "${searchQuery.trim()}".`}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Role</th>
                  <th>Employment type</th>
                  <th>Department</th>
                  <th>Joined</th>
                  <th>Reports to</th>
                </tr>
              </thead>
              <tbody>
                {filteredPeople.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <button
                        type="button"
                        className="cell-name cell-name--btn"
                        onClick={() => onViewProfile?.(p.id)}
                        title={`View ${p.name}'s profile`}
                      >
                        <Avatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                        <div>
                          <strong>{p.name}</strong>
                          <em>{p.designation || '—'}</em>
                        </div>
                      </button>
                    </td>
                    <td>
                      {p.status === 'invited' ? (
                        <div className="invite-cell">
                          <span className="status-pill invited">Invite sent</span>
                          <button
                            type="button"
                            className="btn-tactile ghost sm"
                            disabled={busyInvite?.id === p.id}
                            onClick={() => regenerateInviteLink(p)}
                            title={`Get a fresh invite link for ${p.name}`}
                          >
                            {busyInvite?.id === p.id && busyInvite.kind === 'link' ? 'Creating…' : 'Invite link'}
                          </button>
                          <button
                            type="button"
                            className="btn-tactile ghost sm"
                            disabled={busyInvite?.id === p.id}
                            onClick={() => resendInviteEmail(p)}
                            title={`Email a fresh invite to ${p.email}`}
                          >
                            <Icon name="mail" size={14} />
                            {busyInvite?.id === p.id && busyInvite.kind === 'email' ? 'Sending…' : 'Resend'}
                          </button>
                        </div>
                      ) : (
                        <span className="status-pill active">Active</span>
                      )}
                    </td>
                    <td>
                      {p.id === currentUser?.id ? (
                        // Your own row stays read-only — the server refuses
                        // self-role-changes, so don't offer a dead control.
                        <span className={`role-pill ${p.role}`} title="You can't change your own role">
                          {p.role}
                        </span>
                      ) : (
                        <>
                          <label className="sr-only" htmlFor={`role-${p.id}`}>
                            Role for {p.name}
                          </label>
                          <select
                            id={`role-${p.id}`}
                            className="mini-select"
                            value={p.role}
                            disabled={busyRoleId === p.id}
                            onChange={(e) => changeRole(p.id, e.target.value)}
                          >
                            <option value="employee">Employee</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                          </select>
                        </>
                      )}
                    </td>
                    <td>{p.employmentTypeName || '—'}</td>
                    <td>{p.department || '—'}</td>
                    <td>{p.joiningDate ? formatDate(p.joiningDate, true) : '—'}</td>
                    <td>
                      <label className="sr-only" htmlFor={`mgr-${p.id}`}>
                        Manager for {p.name}
                      </label>
                      <select
                        id={`mgr-${p.id}`}
                        className="mini-select"
                        value={p.managerId || ''}
                        disabled={busyManagerId === p.id}
                        onChange={(e) => changeManager(p.id, e.target.value)}
                      >
                        <option value="">— None —</option>
                        {managerCandidates.filter((m) => m.id !== p.id).map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Share-the-invite-link dialog — the only place the raw link appears. */}
      {inviteModal && (
        <Modal titleId="invite-link-title" onClose={() => setInviteModal(null)}>
          <div className="modal__head">
            <h2 id="invite-link-title">Invite {inviteModal.name}</h2>
            <button className="icon-btn sm" onClick={() => setInviteModal(null)} aria-label="Close dialog">
              <Icon name="x" size={16} />
            </button>
          </div>
          {inviteModal.note && <InlineError>{inviteModal.note}</InlineError>}
          <p className="field-hint" style={{ marginBottom: 12 }}>
            {inviteModal.emailSent
              ? `This link has been emailed to ${inviteModal.email} — you can also share it directly (chat, another email — whatever you use). `
              : `Share this link with ${inviteModal.name} (email, chat — whatever you use). `}
            They’ll set their own password and finish registering. The link works once and
            expires in 7 days; you can issue a new one anytime from the roster.
          </p>
          <div className="field">
            <label htmlFor="invite-link">Invite link</label>
            <input id="invite-link" readOnly value={inviteModal.url} onFocus={(e) => e.target.select()} />
          </div>
          <div className="modal__actions">
            <button type="button" className="btn-tactile ghost" onClick={() => setInviteModal(null)}>
              Done
            </button>
            <button type="button" className="btn-tactile primary" onClick={copyInviteLink}>
              <Icon name={inviteCopied ? 'check' : 'fileText'} size={16} />
              {inviteCopied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
