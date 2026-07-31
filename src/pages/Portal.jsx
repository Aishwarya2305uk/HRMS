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
import { getSavedTheme, saveTheme } from '../lib/themes'

import AttendanceCard from '../components/AttendanceCard'
import LeaveBalanceCard from '../components/LeaveBalanceCard'
import RecentLeaves from '../components/RecentLeaves'
import ApplyLeaveModal from '../components/ApplyLeaveModal'
import WfhRequests from '../components/WfhRequests'
import WfhApplyCard from '../components/WfhApplyCard'
import ApplyWfhModal from '../components/ApplyWfhModal'
import Approvals from '../components/Approvals'
import AttendanceHistory from '../components/AttendanceHistory'
import AttendanceAnalytics from '../components/AttendanceAnalytics'
import OrgTree from '../components/OrgTree'
import LeaveCalendar from '../components/LeaveCalendar'
import PeopleAdmin from '../components/PeopleAdmin'
import AllLeaves from '../components/AllLeaves'
import AllAttendance from '../components/AllAttendance'
import AllAnnouncements from '../components/AllAnnouncements'
import LeaveTypesManager from '../components/LeaveTypesManager'
import EmploymentTypesManager from '../components/EmploymentTypesManager'
import Profile from '../components/Profile'
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
  allattendance: 'Search by employee…',
  announcements: 'Search announcements…',
}

/** Every section Portal can show, independent of role — just "what it looks
 *  like in the sidebar" (label, icon, which live count feeds its badge).
 *  Who gets it is decided separately, by ROLE_SECTIONS below. */
const NAV_ITEMS = {
  dashboard: { label: 'Dashboard', icon: 'grid' },
  notifications: { label: 'Notifications', icon: 'bell', badgeKey: 'notifications', badgeLabel: 'unread' },
  attendance: { label: 'Attendance', icon: 'clock' },
  leaves: { label: 'Leaves', icon: 'leaf' },
  approvals: { label: 'Approvals', icon: 'check', badgeKey: 'approvals', badgeLabel: 'pending' },
  announcements: { label: 'Announcements', icon: 'megaphone' },
  people: { label: 'People', icon: 'users' },
  allleaves: { label: 'All leaves', icon: 'calendarDays' },
  allattendance: { label: 'All attendance', icon: 'list' },
  leavepolicies: { label: 'Leave Policies', icon: 'sliders' },
  org: { label: 'Organization', icon: 'tree' },
  calendar: { label: 'Calendar', icon: 'calendar' },
}

/**
 * Portal is the ONE dashboard shell for every role (see App.jsx — both
 * /dashboard and /admin/dashboard render it). This table is the single place
 * that specifies which components each role gets: it drives the sidebar nav,
 * the dashboard's quick-access tiles, and (via `canAccess`/`isManager`
 * below) which content blocks render for a given tab. Order here is sidebar
 * order.
 */
// Manager and admin get a dedicated "Announcements" section (compose + manage
// sent messages), which makes a separate "Notifications" sidebar entry
// redundant for them — so it's dropped for those two roles. Employees have no
// Announcements section, so they keep Notifications as their only way in.
// (The topbar bell still opens the same drawer for everyone, regardless.)
const ROLE_SECTIONS = {
  employee: ['dashboard', 'notifications', 'attendance', 'leaves', 'org', 'calendar'],
  manager: ['dashboard', 'attendance', 'leaves', 'approvals', 'announcements', 'org', 'calendar'],
  admin: ['dashboard', 'attendance', 'leaves', 'approvals', 'announcements', 'people', 'allleaves', 'allattendance', 'leavepolicies', 'org', 'calendar'],
}

function canAccess(role, key) {
  return (ROLE_SECTIONS[role] ?? ROLE_SECTIONS.employee).includes(key)
}

/** Sidebar items available to `role`, in order. `badges` supplies live
 *  counts for the items that carry a nav-badge (unread notifications,
 *  pending approvals). */
function navFor(role, badges = {}) {
  return (ROLE_SECTIONS[role] ?? ROLE_SECTIONS.employee).map((key) => {
    const item = NAV_ITEMS[key]
    return {
      key,
      label: item.label,
      icon: item.icon,
      badge: item.badgeKey ? badges[item.badgeKey] : undefined,
      badgeLabel: item.badgeLabel,
    }
  })
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
  const [showApplyWfh, setShowApplyWfh] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  // 'YYYY-MM' — which month the admin All Attendance view is browsing.
  const [attendanceMonth, setAttendanceMonth] = useState(() => new Date().toISOString().slice(0, 7))
  // null = viewing your own profile; an id = an admin viewing someone else's
  // (opened from the People roster).
  const [profileTarget, setProfileTarget] = useState(null)
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('hrms.sidebarCollapsed') === '1',
  )

  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem('hrms.sidebarCollapsed', c ? '0' : '1')
      return !c
    })
  }

  // Workspace theme — every role picks freely from the same 10 options
  // (topbar palette menu). Stored per user id so accounts sharing a browser
  // don't overwrite each other's choice.
  const [theme, setTheme] = useState(() => getSavedTheme(user?.id))
  useEffect(() => {
    setTheme(getSavedTheme(user?.id))
  }, [user?.id])

  function changeTheme(key) {
    setTheme(key)
    saveTheme(user?.id, key)
  }

  function selectTab(key) {
    // Notifications is a transient drawer, not a page — open it in place
    // rather than navigating, so there's nothing behind it to return to.
    if (key === 'notifications') {
      setShowNotifications(true)
      return
    }
    setActive(key)
    setSearchQuery('') // a filter from one section shouldn't silently apply to the next
  }

  const isManager = canAccess(role, 'approvals')

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
    enabled: active === 'people' && canAccess(role, 'people'),
  })
  const allLeavesQ = useAsyncData(useCallback(() => leavesApi.all(), []), {
    enabled: active === 'allleaves' && canAccess(role, 'allleaves'),
  })
  const allAttendanceQ = useAsyncData(
    useCallback(() => attendance.all(attendanceMonth), [attendanceMonth]),
    { enabled: active === 'allattendance' && canAccess(role, 'allattendance') },
  )
  // useAsyncData only auto-fetches when `enabled` flips false->true, not when
  // the fetcher's own closure changes — so navigating months while already on
  // this tab (enabled stays true throughout) needs an explicit reload. Reads
  // `active` via a ref (same trick useAsyncData itself uses for `fetcher`)
  // so switching tabs doesn't ALSO retrigger this — only an actual month
  // change should, since the enabled-flip case is already handled above.
  const activeRef = useRef(active)
  activeRef.current = active
  const reloadAttendance = allAttendanceQ.reload
  useEffect(() => {
    if (activeRef.current === 'allattendance') reloadAttendance()
  }, [attendanceMonth, reloadAttendance])
  const analyticsQ = useAsyncData(useCallback(() => attendance.analytics(), []), {
    enabled: active === 'attendance',
  })
  const sentAnnouncementsQ = useAsyncData(useCallback(() => announcementsApi.sent(), []), {
    enabled: active === 'announcements' && canAccess(role, 'announcements'),
  })
  // Own profile when profileTarget is null, otherwise whichever employee an
  // admin opened from the People roster — the API enforces that only an
  // admin may ever actually receive someone else's record.
  const isSelfProfile = !profileTarget || profileTarget === user?.id
  const profileQ = useAsyncData(
    useCallback(() => employeesApi.profile(profileTarget ?? user?.id), [profileTarget, user?.id]),
    { enabled: active === 'profile' && Boolean(profileTarget ?? user?.id) },
  )

  const types = configQ.data?.types ?? EMPTY
  // /leaves/mine returns both kinds mixed (kind: 'leave' | 'wfh') — split them
  // for the two dedicated lists below, but keep counts like "pending requests"
  // computed from the unsplit set, so a pending WFH request counts too.
  const allMine = myLeavesQ.data ?? EMPTY
  const myLeaves = useMemo(() => allMine.filter((l) => l.kind !== 'wfh'), [allMine])
  const myWfh = useMemo(() => allMine.filter((l) => l.kind === 'wfh'), [allMine])
  const history = historyQ.data ?? EMPTY
  const pending = pendingQ.data ?? EMPTY
  const announcementsList = announcementsQ.data ?? EMPTY
  const myPendingLeaves = useMemo(
    () => allMine.filter((l) => l.status === 'pending'),
    [allMine],
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
    // Analytics is lazy-loaded (only once the Attendance tab has been
    // opened) — only refresh it if it's actually been fetched already.
    if (analyticsQ.data !== null) analyticsQ.reload()
  }, [reloadHistory, analyticsQ])

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
    navigate('/', { replace: true })
  }

  function onLeaveCreated(leave) {
    myLeavesQ.setData((prev) => [leave, ...(prev ?? [])])
    toast.success('Leave request submitted — your manager has been notified.')
  }

  function onLeaveCancelled(id) {
    myLeavesQ.setData((prev) => (prev ?? []).filter((l) => l.id !== id))
    toast.success('Leave request cancelled.')
  }

  // Same underlying list as leave (myLeavesQ) — /leaves/mine returns both
  // kinds — so creating/cancelling a WFH request only differs in the toast copy.
  function onWfhCreated(wfh) {
    myLeavesQ.setData((prev) => [wfh, ...(prev ?? [])])
    toast.success('Work-from-home request submitted — your manager has been notified.')
  }

  function onWfhCancelled(id) {
    myLeavesQ.setData((prev) => (prev ?? []).filter((l) => l.id !== id))
    toast.success('Work-from-home request cancelled.')
  }

  function onAnnouncementCreated(item) {
    announcementsQ.setData((prev) => [item, ...(prev ?? [])])
    // Keep the dedicated Announcements page in sync too, if it's already loaded.
    if (sentAnnouncementsQ.data !== null) {
      sentAnnouncementsQ.setData((prev) => [item, ...(prev ?? [])])
    }
    toast.success(item.type === 'urgent' ? 'Urgent message posted.' : 'Announcement posted.')
  }

  function onAnnouncementRemoved(id) {
    announcementsQ.setData((prev) => (prev ?? []).filter((a) => a.id !== id))
    if (sentAnnouncementsQ.data !== null) {
      sentAnnouncementsQ.setData((prev) => (prev ?? []).filter((a) => a.id !== id))
    }
    toast.success('Announcement removed.')
  }

  const onApprovalDecided = useCallback(
    (id, outcome, employeeName, kind) => {
      pendingQ.setData((prev) => (prev ?? []).filter((l) => l.id !== id))
      const noun = kind === 'wfh' ? 'work-from-home request' : 'leave'
      toast.success(
        outcome === 'approved'
          ? `Approved ${employeeName}'s ${noun}.${kind === 'wfh' ? '' : ' Their balance has been updated.'}`
          : `Rejected ${employeeName}'s ${noun}.`,
      )
      // A decision changes company-wide data; refresh anything already on screen.
      if (allLeavesQ.data !== null) allLeavesQ.reload()
      refreshUser()
    },
    [pendingQ, allLeavesQ, toast, refreshUser],
  )

  /** Opens the profile page — your own (id omitted) or, for an admin, anyone else's. */
  function openProfile(id = null) {
    setProfileTarget(id)
    setActive('profile')
  }

  function onProfileSaved(updated) {
    profileQ.setData(updated)
    // Your own header/sidebar avatar and name come from AuthContext's user,
    // which this PATCH never touches directly — refresh it so a new photo or
    // detail shows up immediately instead of only after the next reload.
    if (isSelfProfile) refreshUser()
    // Keep the admin roster in step if it's already loaded, same as the
    // manager-reassignment flow in PeopleAdmin does for its own edits.
    if (peopleQ.data !== null) {
      peopleQ.setData((prev) => (prev ?? []).map((p) => (p.id === updated.id ? { ...p, ...updated } : p)))
    }
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
  const nav = navFor(role, { notifications: unreadCount, approvals: pending.length })
  // 'profile' is deliberately not part of `nav` (see ROLE_SECTIONS) — it's
  // reached via the account menu or a People row, not a sidebar item — so it
  // needs its own title here instead of falling back to "Dashboard".
  const activeLabel =
    active === 'profile'
      ? isSelfProfile
        ? 'My profile'
        : profileQ.data?.name
          ? `${profileQ.data.name}'s profile`
          : 'Profile'
      : nav.find((n) => n.key === active)?.label ?? 'Dashboard'
  const isSearchable = active in SEARCHABLE_TABS

  function openNotifications() {
    setShowNotifications(true)
  }

  return (
    <div className={`emp${collapsed ? ' emp--collapsed' : ''}`} data-role={role} data-theme={theme || undefined}>
      <Sidebar
        nav={nav}
        active={active}
        onSelect={selectTab}
        role={role}
        userName={user?.name}
        userTitle={user?.designation}
        userPhotoUrl={user?.photoUrl}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        onOpenProfile={() => openProfile(null)}
      />

      {/* ---------------- Main ---------------- */}
      <div className="emp__main">
        <TopBar
          dateLabel={dateLabel}
          title={activeLabel}
          greeting={active === 'dashboard' ? `Good to see you, ${firstName}` : undefined}
          searchable={isSearchable}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={SEARCHABLE_TABS[active]}
          notificationCount={unreadCount}
          onBellClick={openNotifications}
          theme={theme}
          onThemeChange={changeTheme}
          user={user}
          role={role}
          onLogout={handleLogout}
          onOpenProfile={() => openProfile(null)}
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
              <Section query={analyticsQ} skeletonRows={4}>
                {analyticsQ.data && <AttendanceAnalytics data={analyticsQ.data} />}
              </Section>
              <Section query={historyQ} skeletonRows={5}>
                <AttendanceHistory rows={history} />
              </Section>
            </div>
          )}

          {active === 'leaves' && (
            <div className="single-col">
              {/* Upper card — applying: leave (left) and WFH (right). */}
              <section className="card leaves-duo pop" style={{ '--d': '370ms' }}>
                <LeaveBalanceCard
                  plain
                  user={user}
                  types={types}
                  loading={configQ.loading}
                  onApply={() => setShowApply(true)}
                  canApply={types.length > 0}
                />
                <WfhApplyCard
                  onApply={() => setShowApplyWfh(true)}
                  pendingCount={myWfh.filter((r) => r.status === 'pending').length}
                />
              </section>

              {/* Lower card — request history: leave (left) and WFH (right). */}
              <section className="card leaves-duo pop" style={{ '--d': '440ms' }}>
                <RecentLeaves
                  plain
                  title="Leave request history"
                  leaves={myLeaves}
                  typeLabels={typeLabels}
                  loading={myLeavesQ.loading && myLeavesQ.data === null}
                  error={myLeavesQ.error}
                  onRetry={myLeavesQ.reload}
                  onApply={() => setShowApply(true)}
                  onCancel={onLeaveCancelled}
                />
                <WfhRequests
                  plain
                  showApply={false}
                  title="WFH request history"
                  requests={myWfh}
                  loading={myLeavesQ.loading && myLeavesQ.data === null}
                  error={myLeavesQ.error}
                  onRetry={myLeavesQ.reload}
                  onApply={() => setShowApplyWfh(true)}
                  onCancel={onWfhCancelled}
                />
              </section>
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

          {active === 'calendar' && <LeaveCalendar typeLabels={typeLabels} />}

          {active === 'people' && canAccess(role, 'people') && (
            <Section query={peopleQ} skeletonRows={5}>
              <PeopleAdmin
                people={peopleQ.data ?? []}
                setPeople={peopleQ.setData}
                searchQuery={searchQuery}
                onViewProfile={openProfile}
              />
            </Section>
          )}

          {active === 'profile' && (
            <Section query={profileQ} skeletonRows={6}>
              <Profile
                profile={profileQ.data}
                isSelf={isSelfProfile}
                canEdit={isSelfProfile || role === 'admin'}
                canEditEmploymentType={role === 'admin'}
                onSaved={onProfileSaved}
                onBack={!isSelfProfile ? () => setActive('people') : undefined}
              />
            </Section>
          )}

          {active === 'allleaves' && canAccess(role, 'allleaves') && (
            <Section query={allLeavesQ} skeletonRows={5}>
              <AllLeaves leaves={allLeavesQ.data ?? []} typeLabels={typeLabels} searchQuery={searchQuery} />
            </Section>
          )}

          {active === 'allattendance' && canAccess(role, 'allattendance') && (
            <Section query={allAttendanceQ} skeletonRows={5}>
              <AllAttendance
                rows={allAttendanceQ.data ?? []}
                searchQuery={searchQuery}
                month={attendanceMonth}
                onMonthChange={setAttendanceMonth}
              />
            </Section>
          )}

          {active === 'leavepolicies' && canAccess(role, 'leavepolicies') && (
            <div className="single-col">
              <LeaveTypesManager />
              <EmploymentTypesManager />
            </div>
          )}

          {active === 'announcements' && canAccess(role, 'announcements') && (
            <Section query={sentAnnouncementsQ} skeletonRows={5}>
              <AllAnnouncements
                items={sentAnnouncementsQ.data ?? []}
                onCreated={onAnnouncementCreated}
                onRemoved={onAnnouncementRemoved}
                currentUserId={user?.id}
                role={role}
                searchQuery={searchQuery}
              />
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

      {showApplyWfh && (
        <ApplyWfhModal
          onClose={() => setShowApplyWfh(false)}
          onCreated={onWfhCreated}
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
