import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useAsyncData } from '../lib/useAsyncData'
import Icon from '../components/Icon'
import { haptic, tactile } from '../lib/haptics'
import {
  attendance,
  leaves as leavesApi,
  employees as employeesApi,
  announcements as announcementsApi,
} from '../lib/hrms'
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
import Sidebar from '../components/dashboard/Sidebar'
import TopBar from '../components/dashboard/TopBar'
import QuickAccessTiles from '../components/dashboard/QuickAccessTiles'
import NotificationsPanel from '../components/notifications/NotificationsPanel'

import './EmployeeDashboard.css'
import './Portal.css'

/** Sections whose data is a filterable list of people — everywhere else the
 *  top bar search box is simply not shown. */
const SEARCHABLE_TABS = {
  org: 'Search the organization…',
  people: 'Search people…',
  allleaves: 'Search by employee…',
}

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
  const [showNotifications, setShowNotifications] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('hrms.sidebarCollapsed') === '1',
  )

  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem('hrms.sidebarCollapsed', c ? '0' : '1')
      return !c
    })
  }

  function selectTab(key) {
    setActive(key)
    setSearchQuery('') // a filter from one section shouldn't silently apply to the next
  }

  const isManager = role === 'manager' || role === 'admin'

  // ---- Shared data (loaded up front, with visible failure states) ----
  const configQ = useAsyncData(useCallback(() => leavesApi.config(), []))
  const myLeavesQ = useAsyncData(useCallback(() => leavesApi.mine(), []))
  const historyQ = useAsyncData(useCallback(() => attendance.history(), []))
  const pendingQ = useAsyncData(useCallback(() => leavesApi.pending(), []), {
    enabled: isManager,
  })
  const announcementsQ = useAsyncData(useCallback(() => announcementsApi.list(), []))

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
  const announcementsList = announcementsQ.data ?? EMPTY
  const myPendingLeaves = useMemo(
    () => myLeaves.filter((l) => l.status === 'pending'),
    [myLeaves],
  )
  const unreadCount = useMemo(
    () => announcementsList.filter((a) => !a.read).length,
    [announcementsList],
  )

  const typeLabels = useMemo(
    () => Object.fromEntries(types.map((t) => [t.key, t.label])),
    [types],
  )

  // If the leave types can't load, the apply form can't be trusted — tell the
  // user ONCE. The ref guard matters: pushing a toast changes the toast
  // context's identity, which would re-run this effect and spam notifications.
  const warnedConfigRef = useRef(false)
  const toastError = toast.error
  useEffect(() => {
    if (configQ.error && !warnedConfigRef.current) {
      warnedConfigRef.current = true
      toastError('Leave types couldn’t load, so applying is unavailable right now.')
    }
    if (!configQ.error) warnedConfigRef.current = false
  }, [configQ.error, toastError])

  // Depend on `reload` (stable) rather than the query object (new every
  // render) — otherwise this callback's identity churns and re-triggers the
  // child's load effect on a loop.
  const reloadHistory = historyQ.reload
  const refreshAfterAttendance = useCallback(() => {
    reloadHistory()
  }, [reloadHistory])

  // Same rationale as above: NotificationsPanel keys an effect off this
  // callback's identity, so it must stay stable even though calling it
  // updates announcementsQ's data (which would otherwise churn a new
  // identity every render if we depended on the query object itself).
  const setAnnouncementsData = announcementsQ.setData
  const onAnnouncementsRead = useCallback(() => {
    setAnnouncementsData((prev) => (prev ?? []).map((a) => (a.read ? a : { ...a, read: true })))
  }, [setAnnouncementsData])

  function handleLogout() {
    haptic('medium')
    logout()
    navigate(role === 'admin' ? '/admin' : '/', { replace: true })
  }

  function onLeaveCreated(leave) {
    myLeavesQ.setData((prev) => [leave, ...(prev ?? [])])
    toast.success('Leave request submitted — your manager has been notified.')
  }

  function onLeaveCancelled(id) {
    myLeavesQ.setData((prev) => (prev ?? []).filter((l) => l.id !== id))
    toast.success('Leave request cancelled.')
  }

  function onAnnouncementCreated(item) {
    announcementsQ.setData((prev) => [item, ...(prev ?? [])])
    toast.success(item.type === 'urgent' ? 'Urgent message posted.' : 'Announcement posted.')
  }

  function onAnnouncementRemoved(id) {
    announcementsQ.setData((prev) => (prev ?? []).filter((a) => a.id !== id))
    toast.success('Announcement removed.')
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
    const list = [
      { icon: 'leaf', tint: 'indigo', label: 'Leave balance', value: user?.leaveBalance ?? 0, unit: 'days' },
      { icon: 'check', tint: 'green', label: 'Present this month', value: presentDays, unit: 'days' },
      { icon: 'clock', tint: 'blue', label: 'Avg. hours / day', value: avgSec ? formatHours(avgSec) : '—', unit: '' },
    ]
    if (isManager) {
      list.push({ icon: 'users', tint: 'amber', label: 'Pending approvals', value: pending.length, unit: '' })
    } else {
      list.push({ icon: 'trending', tint: 'amber', label: 'My pending requests', value: myPendingLeaves.length, unit: '' })
    }
    return list
  }, [history, myPendingLeaves, pending, user, isManager])

  const firstName = user?.name?.split(' ')[0] ?? 'there'
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const nav = navFor(role)
  const activeLabel = nav.find((n) => n.key === active)?.label ?? 'Dashboard'
  const isSearchable = active in SEARCHABLE_TABS

  function openNotifications() {
    setShowNotifications(true)
  }

  return (
    <div className={`emp${collapsed ? ' emp--collapsed' : ''}`} data-role={role}>
      <Sidebar
        nav={nav}
        active={active}
        onSelect={selectTab}
        role={role}
        pendingCount={pending.length}
        userName={user?.name}
        userTitle={user?.designation}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />

      {/* ---------------- Main ---------------- */}
      <div className="emp__main">
        <TopBar
          dateLabel={dateLabel}
          title={activeLabel}
          greeting={active === 'dashboard' ? (
            <>Good to see you, {firstName} <span className="wave">👋</span></>
          ) : undefined}
          searchable={isSearchable}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={SEARCHABLE_TABS[active]}
          notificationCount={unreadCount}
          onBellClick={openNotifications}
          user={user}
          role={role}
          onLogout={handleLogout}
        />

        <div className="emp__content">
          {active === 'dashboard' && (
            <>
              <QuickAccessTiles
                items={nav.filter((n) => n.key !== 'dashboard')}
                onSelect={selectTab}
              />

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
                  onCancel={onLeaveCancelled}
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
            <div className="leaves-grid">
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
                onCancel={onLeaveCancelled}
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
              <OrgTree roots={orgQ.data?.roots ?? []} currentUserId={user?.id} searchQuery={searchQuery} />
            </Section>
          )}

          {active === 'calendar' && <LeaveCalendar />}

          {active === 'people' && (
            <Section query={peopleQ} skeletonRows={5}>
              <PeopleAdmin people={peopleQ.data ?? []} setPeople={peopleQ.setData} searchQuery={searchQuery} />
            </Section>
          )}

          {active === 'allleaves' && (
            <Section query={allLeavesQ} skeletonRows={5}>
              <AllLeaves leaves={allLeavesQ.data ?? []} typeLabels={typeLabels} searchQuery={searchQuery} />
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

      {showNotifications && (
        <NotificationsPanel
          query={announcementsQ}
          onMarkedRead={onAnnouncementsRead}
          canCompose={isManager}
          onCreated={onAnnouncementCreated}
          onRemoved={onAnnouncementRemoved}
          approvalsPending={pending}
          myPendingLeaves={myPendingLeaves}
          typeLabels={typeLabels}
          currentUserId={user?.id}
          role={role}
          onViewApprovals={() => { selectTab('approvals'); setShowNotifications(false) }}
          onViewLeaves={() => { selectTab('leaves'); setShowNotifications(false) }}
          onClose={() => setShowNotifications(false)}
        />
      )}
    </div>
  )
}
