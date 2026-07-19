import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useAsyncData } from '../lib/useAsyncData'
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
import { SkeletonCard, ErrorState, InlineError } from '../components/States'

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

/** Stable identity for "no data yet" so memos don't recompute every render. */
const EMPTY = []

/** Renders loading / error / content for a lazily-loaded section. */
function Section({ query, children, skeletonRows = 4 }) {
  if (query.loading && query.data === null) return <SkeletonCard rows={skeletonRows} />
  if (query.error && query.data === null) {
    return <ErrorState message={query.error.message} onRetry={query.reload} retrying={query.loading} />
  }
  return children
}

export default function Portal() {
  const { user, role, logout, refreshUser } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [active, setActive] = useState('dashboard')
  const [showApply, setShowApply] = useState(false)

  const isManager = role === 'manager' || role === 'admin'

  // ---- Shared data (loaded up front, with visible failure states) ----
  const configQ = useAsyncData(useCallback(() => leavesApi.config(), []))
  const myLeavesQ = useAsyncData(useCallback(() => leavesApi.mine(), []))
  const historyQ = useAsyncData(useCallback(() => attendance.history(), []))
  const pendingQ = useAsyncData(useCallback(() => leavesApi.pending(), []), {
    enabled: isManager,
  })

  // ---- Lazily loaded per section ----
  const orgQ = useAsyncData(useCallback(() => employeesApi.orgTree(), []), {
    enabled: active === 'org',
  })
  const peopleQ = useAsyncData(useCallback(() => employeesApi.list(), []), {
    enabled: active === 'people',
  })
  const allLeavesQ = useAsyncData(useCallback(() => leavesApi.all(), []), {
    enabled: active === 'allleaves',
  })

  const types = configQ.data?.types ?? EMPTY
  const myLeaves = myLeavesQ.data ?? EMPTY
  const history = historyQ.data ?? EMPTY
  const pending = pendingQ.data ?? EMPTY

  const typeLabels = useMemo(
    () => Object.fromEntries(types.map((t) => [t.key, t.label])),
    [types],
  )

  // If the leave types can't load, the apply form can't be trusted — tell the
  // user once rather than letting them open a broken form.
  useEffect(() => {
    if (configQ.error) {
      toast.error('Leave types couldn’t load, so applying is unavailable right now.')
    }
  }, [configQ.error, toast])

  const refreshAfterAttendance = useCallback(() => {
    historyQ.reload()
  }, [historyQ])

  function handleLogout() {
    haptic('medium')
    logout()
    navigate(role === 'admin' ? '/admin' : '/', { replace: true })
  }

  function onLeaveCreated(leave) {
    myLeavesQ.setData((prev) => [leave, ...(prev ?? [])])
    toast.success('Leave request submitted — your manager has been notified.')
  }

  const onApprovalDecided = useCallback(
    (id, outcome, employeeName) => {
      pendingQ.setData((prev) => (prev ?? []).filter((l) => l.id !== id))
      toast.success(
        outcome === 'approved'
          ? `Approved ${employeeName}'s leave. Their balance has been updated.`
          : `Rejected ${employeeName}'s leave.`,
      )
      // A decision changes company-wide data; refresh anything already on screen.
      if (allLeavesQ.data !== null) allLeavesQ.reload()
      refreshUser()
    },
    [pendingQ, allLeavesQ, toast, refreshUser],
  )

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

        <nav className="emp__nav" aria-label="Main">
          {nav.map((item) => (
            <button
              key={item.key}
              className={`nav-item${active === item.key ? ' is-active' : ''}`}
              aria-current={active === item.key ? 'page' : undefined}
              onClick={() => { haptic('light'); setActive(item.key) }}
              {...tactile('light')}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.key === 'approvals' && pending.length > 0 && (
                <span className="nav-badge" aria-label={`${pending.length} pending`}>
                  {pending.length}
                </span>
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

              {/* A failed history load shouldn't silently zero the stats above. */}
              {historyQ.error && (
                <InlineError onRetry={historyQ.reload}>
                  Attendance figures may be out of date — {historyQ.error.message}
                </InlineError>
              )}

              <div className="emp__grid">
                <AttendanceCard onChange={refreshAfterAttendance} />
                <LeaveBalanceCard
                  user={user}
                  types={types}
                  loading={configQ.loading}
                  onApply={() => setShowApply(true)}
                  canApply={types.length > 0}
                />
                <RecentLeaves
                  leaves={myLeaves}
                  typeLabels={typeLabels}
                  limit={5}
                  loading={myLeavesQ.loading && myLeavesQ.data === null}
                  error={myLeavesQ.error}
                  onRetry={myLeavesQ.reload}
                  onApply={() => setShowApply(true)}
                />
              </div>

              {isManager && (
                <Approvals
                  pending={pending}
                  typeLabels={typeLabels}
                  onDecided={onApprovalDecided}
                  loading={pendingQ.loading && pendingQ.data === null}
                  error={pendingQ.error}
                  onRetry={pendingQ.reload}
                />
              )}
            </>
          )}

          {active === 'attendance' && (
            <div className="single-col">
              <AttendanceCard onChange={refreshAfterAttendance} />
              <Section query={historyQ} skeletonRows={5}>
                <AttendanceHistory rows={history} />
              </Section>
            </div>
          )}

          {active === 'leaves' && (
            <div className="two-col">
              <LeaveBalanceCard
                user={user}
                types={types}
                loading={configQ.loading}
                onApply={() => setShowApply(true)}
                canApply={types.length > 0}
              />
              <RecentLeaves
                leaves={myLeaves}
                typeLabels={typeLabels}
                loading={myLeavesQ.loading && myLeavesQ.data === null}
                error={myLeavesQ.error}
                onRetry={myLeavesQ.reload}
                onApply={() => setShowApply(true)}
              />
            </div>
          )}

          {active === 'approvals' && isManager && (
            <Approvals
              pending={pending}
              typeLabels={typeLabels}
              onDecided={onApprovalDecided}
              loading={pendingQ.loading && pendingQ.data === null}
              error={pendingQ.error}
              onRetry={pendingQ.reload}
            />
          )}

          {active === 'org' && (
            <Section query={orgQ} skeletonRows={5}>
              <OrgTree roots={orgQ.data?.roots ?? []} currentUserId={user?.id} />
            </Section>
          )}

          {active === 'calendar' && <LeaveCalendar />}

          {active === 'people' && (
            <Section query={peopleQ} skeletonRows={5}>
              <PeopleAdmin people={peopleQ.data ?? []} setPeople={peopleQ.setData} />
            </Section>
          )}

          {active === 'allleaves' && (
            <Section query={allLeavesQ} skeletonRows={5}>
              <AllLeaves leaves={allLeavesQ.data ?? []} typeLabels={typeLabels} />
            </Section>
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
