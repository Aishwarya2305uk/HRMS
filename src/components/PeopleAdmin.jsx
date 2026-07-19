import { useState } from 'react'
import Icon from './Icon'
import { employees as employeesApi } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { formatDate } from '../lib/format'

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

/**
 * Admin people management: add an employee (assigning their manager, which is
 * what wires the org tree) and view/edit everyone. Reassigning a manager
 * restructures the tree live.
 *
 * @param {Array}            props.people     from /employees
 * @param {(list)=>void}     props.setPeople  update after add/edit
 */
export default function PeopleAdmin({ people, setPeople }) {
  const [form, setForm] = useState(BLANK)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [saving, setSaving] = useState(false)

  // Anyone can be a manager in v1 (managers + admins are the usual picks).
  const managerChoices = people.filter((p) => p.role !== 'employee' || true)

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function addEmployee(e) {
    e.preventDefault()
    setError('')
    setOk('')
    if (!form.name || !form.email || !form.password) {
      return setError('Name, email and password are required.')
    }
    setSaving(true)
    haptic('medium')
    try {
      const created = await employeesApi.add({ ...form, managerId: form.managerId || null })
      const managerName = people.find((p) => p.id === form.managerId)?.name ?? null
      setPeople([...people, { ...created, managerName }])
      setForm(BLANK)
      setOk(`${created.name} added.`)
      haptic('success')
    } catch (err) {
      setError(err.message || 'Could not add the employee.')
    } finally {
      setSaving(false)
    }
  }

  async function changeManager(id, managerId) {
    haptic('light')
    try {
      await employeesApi.setManager(id, managerId || null)
      const managerName = people.find((p) => p.id === managerId)?.name ?? null
      setPeople(people.map((p) => (p.id === id ? { ...p, managerId: managerId || null, managerName } : p)))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="people">
      <section className="card pop" style={{ '--d': '80ms' }}>
        <div className="attendance__head">
          <h2>Add employee</h2>
        </div>

        {error && (
          <div className="auth-error" role="alert"><span aria-hidden="true">⚠️</span>{error}</div>
        )}
        {ok && <div className="ok-banner"><Icon name="check" size={15} /> {ok}</div>}

        <form onSubmit={addEmployee} className="add-form">
          <div className="field-row">
            <div className="field">
              <label>Full name</label>
              <input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Jane Doe" required />
            </div>
            <div className="field">
              <label>Work email</label>
              <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="jane@trula.com" required />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Temporary password</label>
              <input type="text" value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="At least 6 characters" required />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={form.role} onChange={(e) => update('role', e.target.value)}>
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Designation</label>
              <input value={form.designation} onChange={(e) => update('designation', e.target.value)} placeholder="Software Engineer" />
            </div>
            <div className="field">
              <label>Department</label>
              <input value={form.department} onChange={(e) => update('department', e.target.value)} placeholder="Engineering" />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Joining date</label>
              <input type="date" value={form.joiningDate} onChange={(e) => update('joiningDate', e.target.value)} />
            </div>
            <div className="field">
              <label>Reports to (manager)</label>
              <select value={form.managerId} onChange={(e) => update('managerId', e.target.value)}>
                <option value="">— No manager (top level) —</option>
                {managerChoices.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {p.role}</option>
                ))}
              </select>
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
                    <select
                      className="mini-select"
                      value={p.managerId || ''}
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
      </section>
    </div>
  )
}
