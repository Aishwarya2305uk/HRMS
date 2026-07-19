import { useMemo, useState } from 'react'
import Icon from './Icon'
import { employees as employeesApi } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { formatDate } from '../lib/format'
import { useToast } from '../context/ToastContext'
import { EmptyState, InlineError } from './States'

const BLANK = {
  name: '',
  email: '',
  password: '',
  role: 'employee',
  designation: '',
  department: '',
  joiningDate: '',
  managerId: '',
}

/** Mirrors the server's policy so the user finds out before submitting. */
const MIN_PASSWORD = 8
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Admin people management: add an employee (assigning their manager, which is
 * what wires the org tree) and view/edit everyone.
 *
 * UX approach:
 *  - Per-field validation with messages under the offending field.
 *  - Manager changes are optimistic but roll back visibly if the server
 *    rejects them, so the table never shows a change that didn't persist.
 */
export default function PeopleAdmin({ people, setPeople }) {
  const toast = useToast()
  const [form, setForm] = useState(BLANK)
  const [touched, setTouched] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyManagerId, setBusyManagerId] = useState(null)

  const errors = useMemo(() => {
    const e = {}
    if (!form.name.trim()) e.name = 'Enter the employee’s full name.'
    if (!form.email.trim()) e.email = 'Enter a work email.'
    else if (!EMAIL_RE.test(form.email.trim())) e.email = 'That doesn’t look like a valid email.'
    else if (people.some((p) => p.email?.toLowerCase() === form.email.trim().toLowerCase())) {
      e.email = 'Someone already uses that email.'
    }
    if (!form.password) e.password = 'Set a temporary password.'
    else if (form.password.length < MIN_PASSWORD) {
      e.password = `Use at least ${MIN_PASSWORD} characters.`
    }
    return e
  }, [form, people])

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
      const firstBad = ['name', 'email', 'password'].find((f) => errors[f])
      document.getElementById(`emp-${firstBad}`)?.focus()
      return
    }

    setSaving(true)
    haptic('medium')
    try {
      const created = await employeesApi.add({ ...form, managerId: form.managerId || null })
      const managerName = people.find((p) => p.id === form.managerId)?.name ?? null
      setPeople([...people, { ...created, managerName }])
      setForm(BLANK)
      setTouched({})
      haptic('success')
      toast.success(
        `${created.name} added${managerName ? `, reporting to ${managerName}` : ''}.`,
      )
    } catch (err) {
      setSubmitError(err.message)
      toast.error(err.message)
    } finally {
      setSaving(false)
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
              <label htmlFor="emp-password">Temporary password</label>
              <input
                id="emp-password"
                type="text"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                onBlur={() => markTouched('password')}
                aria-invalid={Boolean(showError('password'))}
                aria-describedby={showError('password') ? 'err-password' : 'hint-password'}
                placeholder={`At least ${MIN_PASSWORD} characters`}
              />
              {showError('password') ? (
                <p className="field-error" id="err-password">{errors.password}</p>
              ) : (
                <p className="field-hint" id="hint-password">
                  Share it securely — they should change it after signing in.
                </p>
              )}
            </div>
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
              <label htmlFor="emp-manager">Reports to</label>
              <select
                id="emp-manager"
                value={form.managerId}
                onChange={(e) => update('managerId', e.target.value)}
              >
                <option value="">— No manager (top level) —</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {p.role}</option>
                ))}
              </select>
              <p className="field-hint">This is what builds the organization tree.</p>
            </div>
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
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Joined</th>
                  <th>Reports to</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="cell-name">
                        <span className="avatar sm" aria-hidden="true">{p.name?.[0]}</span>
                        <div>
                          <strong>{p.name}</strong>
                          <em>{p.designation || '—'}</em>
                        </div>
                      </div>
                    </td>
                    <td><span className={`role-pill ${p.role}`}>{p.role}</span></td>
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
                        {people.filter((m) => m.id !== p.id).map((m) => (
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
    </div>
  )
}
