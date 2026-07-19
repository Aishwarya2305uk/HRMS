import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icon'
import { haptic, tactile } from '../lib/haptics'
import { attendance, leaves as leavesApi, employees as employeesApi } from '../lib/hrms'
import { formatHours } from '../lib/format'

import AttendanceCard from '../components/AttendanceCard'
import LeaveBalanceCard from '../components/LeaveBalanceCard'
import RecentLeaves from '../components/RecentLeaves'
import ApplyLeaveModal from '../components/ApplyLeaveModal'
import Approvals from '../components/Approvals'
import AttendanceHistory from '../components/AttendanceHistory'
import OrgTree from '../components/OrgTree'
import LeaveCalendar from '../components/LeaveCalendar'
import PeopleAdmin from '../components/PeopleAdmin'
import AllLeaves from '../components/AllLeaves'

import './EmployeeDashboard.css'
import './Portal.css'

/** Sidebar items available to each role (order matters). */
function navFor(role) {
  const base = [
    { key: 'dashboard', label: 'Dashboard', icon: 'grid' },
    { key: 'attendance', label: 'Attendance', icon: 'clock' },
    { key: 'leaves', label: 'Leaves', icon: 'leaf' },
  ]
  if (role === 'manager' || role === 'admin') {
    base.push({ key: 'approvals', label: 'Approvals', icon: 'check' })
  }
  if (role === 'admin') {
    base.push({ key: 'people', label: 'People', icon: 'users' })
    base.push({ key: 'allleaves', label: 'All leaves', icon: 'calendarDays' })
  }
  base.push({ key: 'org', label: 'Organization', icon: 'tree' })
  base.push({ key: 'calendar', label: 'Calendar', icon: 'calendar' })
  return base
}

const thisMonthKey = () => new Date().toISOString().slice(0, 7)

export default function Portal() {
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()
  const [active, setActive] = useState('dashboard')
  const [showApply, setShowApply] = useState(false)

  // Shared data.
  const [types, setTypes] = useState([])
  const [myLeaves, setMyLeaves] = useState([])
  const [history, setHistory] = useState([])
  const [pending, setPending] = useState([])
  // Lazily-loaded per section.
  const [orgRoots, setOrgRoots] = useState(null)
  const [people, setPeople] = useState(null)
  const [allLeaves, setAllLeaves] = useState(null)

  const isManager = role === 'manager' || role === 'admin'
  const typeLabels = useMemo(
    () => Object.fromEntries(types.map((t) => [t.key, t.label])),
    [types],
  )

  // Initial load: config + the current user's own leaves, attendance & queue.
  useEffect(() => {
    leavesApi.config().then((c) => setTypes(c.types)).catch(() => {})
    leavesApi.mine().then(setMyLeaves).catch(() => {})
    attendance.history().then(setHistory).catch(() => {})
    if (isManager) leavesApi.pending().then(setPending).catch(() => {})
  }, [isManager])

  // Lazy loaders — fetch a section's data the first time it's opened.
  useEffect(() => {
    if (active === 'org' && orgRoots === null) {
      employeesApi.orgTree().then((r) => setOrgRoots(r.roots)).catch(() => setOrgRoots([]))
    }
    if (active === 'people' && people === null) {
      employeesApi.list().then(setPeople).catch(() => setPeople([]))
    }
    if (active === 'allleaves' && allLeaves === null) {
      leavesApi.all().then(setAllLeaves).catch(() => setAllLeaves([]))
    }
  }, [active, orgRoots, people, allLeaves])

  const refreshHistory = useCallback(() => {
    attendance.history().then(setHistory).catch(() => {})
  }, [])

  function handleLogout() {
    haptic('medium')
    logout()
    navigate(role === 'admin' ? '/admin' : '/', { replace: true })
  }

  function onLeaveCreated(leave) {
    setMyLeaves((prev) => [leave, ...prev])
  }

  async function onApprovalDecided(id) {
    setPending((prev) => prev.filter((l) => l.id !== id))
    // A decision may change balances / all-leaves; refresh what's loaded.
    if (allLeaves !== null) leavesApi.all().then(setAllLeaves).catch(() => {})
  }

  // ---- Stats for the dashboard header ----
  const stats = useMemo(() => {
    const month = thisMonthKey()
    const monthDays = history.filter((h) => h.date?.startsWith(month))
    const presentDays = monthDays.filter((h) => h.dayStatus === 'present').length
    const finalized = monthDays.filter((h) => h.status !== 'active')
    const avgSec = finalized.length
      ? finalized.reduce((s, h) => s + (h.workedSeconds || 0), 0) / finalized.length
      : 0
    const myPending = myLeaves.filter((l) => l.status === 'pending').length

    const list = [
      { icon: 'leaf', tint: 'indigo', label: 'Leave balance', value: user?.leaveBalance ?? 0, unit: 'days' },
      { icon: 'check', tint: 'green', label: 'Present this month', value: presentDays, unit: 'days' },
      { icon: 'clock', tint: 'blue', label: 'Avg. hours / day', value: avgSec ? formatHours(avgSec) : '—', unit: '' },
    ]
    if (isManager) {
      list.push({ icon: 'users', tint: 'amber', label: 'Pending approvals', value: pending.length, unit: '' })
    } else {
      list.push({ icon: 'trending', tint: 'amber', label: 'My pending requests', value: myPending, unit: '' })
    }
    return list
  }, [history, myLeaves, pending, user, isManager])

  const firstName = user?.name?.split(' ')[0] ?? 'there'
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const nav = navFor(role)
  const activeLabel = nav.find((n) => n.key === active)?.label ?? 'Dashboard'

  return (
    <div className="emp">
      {/* ---------------- Sidebar ---------------- */}
      <aside className="emp__sidebar">
        <div className="emp__logo">
          <span className="mark">◈</span>
          <span>Trula</span>
        </div>

        <nav className="emp__nav">
          {nav.map((item) => (
            <button
              key={item.key}
              className={`nav-item${active === item.key ? ' is-active' : ''}`}
              onClick={() => { haptic('light'); setActive(item.key) }}
              {...tactile('light')}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.key === 'approvals' && pending.length > 0 && (
                <span className="nav-badge">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="emp__side-foot">
          <div className="mini-profile">
            <div className="avatar" aria-hidden="true">{firstName[0]}</div>
            <div className="mini-profile__text">
              <strong>{user?.name}</strong>
              <span>{user?.designation || role}</span>
            </div>
          </div>
          <button className="nav-item logout" onClick={handleLogout} {...tactile('medium')}>
            <Icon name="logout" size={19} />
            <span>Log out</span>
          </button>
        </div>
      </aside>

      {/* ---------------- Main ---------------- */}
      <div className="emp__main">
        <header className="emp__topbar">
          <div>
            <p className="emp__eyebrow">{dateLabel}</p>
            <h1>
              {active === 'dashboard' ? (
                <>Good to see you, {firstName} <span className="wave">👋</span></>
              ) : (
                activeLabel
              )}
            </h1>
          </div>
          <div className="emp__top-actions">
            <span className={`role-pill ${role}`}>{role}</span>
          </div>
        </header>

        <div className="emp__content">
          {active === 'dashboard' && (
            <>
              <section className="stat-row">
                {stats.map((s, i) => (
                  <article key={s.label} className={`card stat pop tint-${s.tint}`} style={{ '--d': `${i * 70}ms` }} tabIndex={0} {...tactile('light')}>
                    <span className="stat__icon"><Icon name={s.icon} size={20} /></span>
                    <div className="stat__meta">
                      <span className="stat__label">{s.label}</span>
                      <span className="stat__value">{s.value}{s.unit && <em>{s.unit}</em>}</span>
                    </div>
                  </article>
                ))}
              </section>

              <div className="emp__grid">
                <AttendanceCard onChange={refreshHistory} />
                <LeaveBalanceCard user={user} types={types} onApply={() => setShowApply(true)} />
                <RecentLeaves leaves={myLeaves} typeLabels={typeLabels} limit={5} />
              </div>

              {isManager && (
                <Approvals pending={pending} typeLabels={typeLabels} onDecided={onApprovalDecided} />
              )}
            </>
          )}

          {active === 'attendance' && (
            <div className="single-col">
              <AttendanceCard onChange={refreshHistory} />
              <AttendanceHistory rows={history} />
            </div>
          )}

          {active === 'leaves' && (
            <div className="two-col">
              <LeaveBalanceCard user={user} types={types} onApply={() => setShowApply(true)} />
              <RecentLeaves leaves={myLeaves} typeLabels={typeLabels} />
            </div>
          )}

          {active === 'approvals' && isManager && (
            <Approvals pending={pending} typeLabels={typeLabels} onDecided={onApprovalDecided} />
          )}

          {active === 'org' && (
            orgRoots === null ? <Loading /> : <OrgTree roots={orgRoots} currentUserId={user?.id} />
          )}

          {active === 'calendar' && <LeaveCalendar />}

          {active === 'people' && (
            people === null ? <Loading /> : <PeopleAdmin people={people} setPeople={setPeople} />
          )}

          {active === 'allleaves' && (
            allLeaves === null ? <Loading /> : <AllLeaves leaves={allLeaves} typeLabels={typeLabels} />
          )}
        </div>
      </div>

      {showApply && (
        <ApplyLeaveModal
          types={types}
          balances={user?.leaveBalances}
          onClose={() => setShowApply(false)}
          onCreated={onLeaveCreated}
        />
      )}
    </div>
  )
}

function Loading() {
  return <div className="loading-block">Loading…</div>
}
