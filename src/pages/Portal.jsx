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
  appSettings as appSettingsApi,
} from '../lib/hrms'
import { formatHours } from '../lib/format'
import { getSavedTheme, saveTheme } from '../lib/themes'

import AttendanceCard from '../components/AttendanceCard'
import LeaveBalanceCard from '../components/LeaveBalanceCard'
import RecentLeaves from '../components/RecentLeaves'
import ApplyLeaveModal from '../components/ApplyLeaveModal'
import WfhRequests from '../components/WfhRequests'
import UpcomingLeaves from '../components/UpcomingLeaves'
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
import OtherSettingsManager from '../components/OtherSettingsManager'
import SystemLogs from '../components/SystemLogs'
import FormLinkSection from '../components/FormLinkSection'
import Profile from '../components/Profile'
import DocumentsCard from '../components/DocumentsCard'
import { SkeletonCard, ErrorState, InlineError } from '../components/States'
import Sidebar from '../components/dashboard/Sidebar'
import TopBar from '../components/dashboard/TopBar'
import NotificationsPanel from '../components/notifications/NotificationsPanel'
import NotificationsPage from '../components/notifications/NotificationsPage'

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
  othersettings: { label: 'Other Settings', icon: 'settings' },
  systemlogs: { label: 'System Logs', icon: 'activity' },
  org: { label: 'Organization', icon: 'tree' },
  calendar: { label: 'Calendar', icon: 'calendar' },
  // Sections that embed the admin-configured external form inline
  // (see FORM_LINKS / Other Settings / FormLinkSection.jsx).
  feedback: { label: 'Feedback', icon: 'messageSquare' },
  hrrequest: { label: 'HR Request', icon: 'lifeBuoy' },
}

/** Sidebar keys whose section embeds an admin-configured external form
 *  (FormLinkSection.jsx). The field names the settings record's key; the
 *  title heads the page; the noun reads naturally in the not-set-up state. */
const FORM_LINKS = {
  feedback: { field: 'feedbackFormUrl', noun: 'feedback form', title: 'Share your feedback' },
  hrrequest: { field: 'hrRequestFormUrl', noun: 'HR request form', title: 'Raise an HR request' },
}

/**
 * Portal is the ONE dashboard shell for every role (see App.jsx — both
 * /dashboard and /admin/dashboard render it). This table is the single place
 * that specifies which components each role gets: it drives the sidebar nav
 * and (via `canAccess`/`isManager` below) which content blocks render for a
 * given tab. Order here is sidebar order.
 */
// Every role gets the dedicated Notifications page in the sidebar (the
// topbar bell still opens the quick-glance drawer). Manager/admin ALSO keep
// their "Announcements" section — that one is for composing and managing
// SENT messages, while Notifications is the received feed plus pending work.
// Org visibility is paused for employees/managers (admin-only for now) — to
// restore it, re-add 'org' to their lists AND drop the matching
// requireRole('admin') on GET /employees/org-tree (server/routes/employees.js).
const ROLE_SECTIONS = {
  employee: ['dashboard', 'notifications', 'attendance', 'leaves', 'calendar', 'feedback', 'hrrequest'],
  manager: ['dashboard', 'notifications', 'attendance', 'leaves', 'approvals', 'announcements', 'calendar', 'feedback', 'hrrequest'],
  admin: ['dashboard', 'notifications', 'attendance', 'leaves', 'approvals', 'announcements', 'people', 'othersettings', 'systemlogs', 'allleaves', 'allattendance', 'leavepolicies', 'org', 'calendar', 'feedback', 'hrrequest'],
}

/** Sections tucked behind the sidebar's expandable "More" item instead of
 *  being listed directly. They stay in ROLE_SECTIONS (that still decides
 *  access); this only changes how the sidebar shows them.
 *  The "More" toggle renders where the first of these falls in sidebar order
 *  — for admin, last, right after Other Settings — and holds enough of the
 *  admin list that the rail fits without scrolling. */
const MORE_SECTIONS = {
  // Employees see every section directly — their list is short enough that
  // nothing needs tucking away.
  employee: [],
  manager: ['feedback', 'hrrequest'],
  admin: ['allleaves', 'allattendance', 'leavepolicies', 'org', 'calendar', 'feedback', 'hrrequest'],
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
      more: (MORE_SECTIONS[role] ?? []).includes(key),
    }
  })
}

const thisMonthKey = () => new Date().toISOString().slice(0, 7)

/** Per-user, per-device "last looked at notifications" watermark (same
 *  localStorage pattern as the theme and sidebar-collapse prefs). */
const notifSeenKey = (userId) => `hrms.notifSeen.${userId ?? 'anon'}`

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
  // When this user last opened a notifications surface (bell drawer or the
  // Notifications page). Announcements carry real server-side read tracking;
  // request decisions and newly-arrived approvals don't — for those, the
  // red-dot logic below compares timestamps against this watermark.
  const [notifSeenAt, setNotifSeenAt] = useState(
    () => Number(localStorage.getItem(notifSeenKey(user?.id))) || 0,
  )
  useEffect(() => {
    setNotifSeenAt(Number(localStorage.getItem(notifSeenKey(user?.id))) || 0)
  }, [user?.id])

  function markNotificationsSeen() {
    const ts = Date.now()
    localStorage.setItem(notifSeenKey(user?.id), String(ts))
    setNotifSeenAt(ts)
  }

  // Phone-only nav drawer (opened by the topbar hamburger). Closed on every
  // section pick so choosing a destination always reveals it.
  const [navOpen, setNavOpen] = useState(false)
  const closeNav = useCallback(() => setNavOpen(false), [])

  // The open drawer overlays the page — freeze the page's own scroll under it.
  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [navOpen])

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
    setNavOpen(false)
    if (key === 'notifications') markNotificationsSeen()
    setActive(key)
    setSearchQuery('') // a filter from one section shouldn't silently apply to the next
  }

  const isManager = canAccess(role, 'approvals')

  // ---- Shared data (loaded up front, with visible failure states) ----
  // Org-wide form links (Feedback / HR Request) — needed by those sidebar
  // items for every role, and edited in place on the admin Other Settings page.
  const settingsQ = useAsyncData(useCallback(() => appSettingsApi.get(), []))
  const configQ = useAsyncData(useCallback(() => leavesApi.config(), []))
  const myLeavesQ = useAsyncData(useCallback(() => leavesApi.mine(), []))
  const historyQ = useAsyncData(useCallback(() => attendance.history(), []))
  const pendingQ = useAsyncData(useCallback(() => leavesApi.pending(), []), {
    enabled: isManager,
  })
  const announcementsQ = useAsyncData(useCallback(() => announcementsApi.list(), []))

  // ---- Lazily loaded per section ----
  const orgQ = useAsyncData(useCallback(() => employeesApi.orgTree(), []), {
    enabled: active === 'org' && canAccess(role, 'org'),
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

  // Keep the work queues fresh without a manual refresh: a manager's new
  // approvals and an employee's decided requests arrive on a 30s heartbeat,
  // plus immediately when the tab regains focus. Silent by design — every
  // consumer only shows a skeleton on FIRST load (data === null), so a
  // background reload never flashes the UI.
  const reloadMyLeaves = myLeavesQ.reload
  const reloadPending = pendingQ.reload
  const reloadAnnouncements = announcementsQ.reload
  const reloadHistory = historyQ.reload
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      reloadMyLeaves()
      reloadAnnouncements()
      // An approved attendance fix flips a history day to Present — keep the
      // table on the same clock as the request lists.
      reloadHistory()
      if (isManager) reloadPending()
    }
    const id = setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [reloadMyLeaves, reloadPending, reloadAnnouncements, reloadHistory, isManager])

  const types = configQ.data?.types ?? EMPTY
  // /leaves/mine returns every kind mixed ('leave' | 'wfh' | 'regularize') —
  // split for the dedicated lists below, but keep counts like "pending
  // requests" computed from the unsplit set, so any pending kind counts.
  const allMine = myLeavesQ.data ?? EMPTY
  const myLeaves = useMemo(() => allMine.filter((l) => l.kind === 'leave'), [allMine])
  const myWfh = useMemo(() => allMine.filter((l) => l.kind === 'wfh'), [allMine])
  // Attendance-fix requests render inside the attendance history table, not
  // the leave lists.
  const myRegularize = useMemo(() => allMine.filter((l) => l.kind === 'regularize'), [allMine])
  const history = historyQ.data ?? EMPTY
  const pending = pendingQ.data ?? EMPTY
  const announcementsList = announcementsQ.data ?? EMPTY
  const myPendingLeaves = useMemo(
    () => allMine.filter((l) => l.status === 'pending'),
    [allMine],
  )
  // Work notifications for the Notifications page: decisions made on your
  // requests in the last two weeks, newest first.
  const myRecentDecisions = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
    return allMine
      .filter((l) => l.status !== 'pending' && l.decidedAt && new Date(l.decidedAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.decidedAt) - new Date(a.decidedAt))
  }, [allMine])
  // Approved time off that hasn't started yet, soonest first — the Leaves
  // tab's "Upcoming leaves" card.
  const myUpcoming = useMemo(() => {
    const now = Date.now()
    return allMine
      .filter((l) => l.status === 'approved' && l.startDate && new Date(l.startDate).getTime() >= now)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
  }, [allMine])
  const unreadCount = useMemo(
    () => announcementsList.filter((a) => !a.read).length,
    [announcementsList],
  )
  // ClickUp-style "something new" red dot: unread announcements plus anything
  // newer than the seen watermark — decisions on your own requests (approved/
  // rejected) and, for managers, requests that just arrived in their queue.
  // The 30s heartbeat keeps the underlying queries fresh, so the dot appears
  // on its own — no page refresh.
  const newDecisionCount = useMemo(
    () =>
      myRecentDecisions.filter((l) => l.decidedAt && new Date(l.decidedAt).getTime() > notifSeenAt)
        .length,
    [myRecentDecisions, notifSeenAt],
  )
  const newApprovalCount = useMemo(
    () =>
      pending.filter((l) => l.createdAt && new Date(l.createdAt).getTime() > notifSeenAt).length,
    [pending, notifSeenAt],
  )
  const notifCount = unreadCount + newDecisionCount + newApprovalCount

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

  // Custom-dates submissions return one request per consecutive block, so
  // both created-handlers accept a single item OR an array.
  function onLeaveCreated(leaveOrBatch) {
    const items = Array.isArray(leaveOrBatch) ? leaveOrBatch : [leaveOrBatch]
    myLeavesQ.setData((prev) => [...items, ...(prev ?? [])])
    toast.success(
      items.length > 1
        ? `${items.length} leave requests submitted (one per consecutive block) — your manager has been notified.`
        : 'Leave request submitted — your manager has been notified.',
    )
  }

  // Cancel outcomes differ by prior status: a pending request is deleted
  // ({ id, removed: true }), an approved one comes back as the full leave now
  // flipped to 'cancelled' — with its balance refunded, so the header stats
  // need a fresh user.
  function onLeaveCancelled(result) {
    if (result?.removed) {
      myLeavesQ.setData((prev) => (prev ?? []).filter((l) => l.id !== result.id))
      toast.success('Leave request cancelled.')
      return
    }
    myLeavesQ.setData((prev) => (prev ?? []).map((l) => (l.id === result.id ? result : l)))
    toast.success('Approved leave cancelled — the days are back in your balance.')
    refreshUser()
    if (allLeavesQ.data !== null) allLeavesQ.reload()
  }

  // Same underlying list as leave (myLeavesQ) — /leaves/mine returns both
  // kinds — so creating/cancelling a WFH request only differs in the toast copy.
  function onWfhCreated(wfhOrBatch) {
    const items = Array.isArray(wfhOrBatch) ? wfhOrBatch : [wfhOrBatch]
    myLeavesQ.setData((prev) => [...items, ...(prev ?? [])])
    toast.success(
      items.length > 1
        ? `${items.length} work-from-home requests submitted (one per consecutive block) — your manager has been notified.`
        : 'Work-from-home request submitted — your manager has been notified.',
    )
  }

  function onRegularizeCreated(item) {
    myLeavesQ.setData((prev) => [item, ...(prev ?? [])])
    toast.success('Fix request sent — your manager has been notified.')
  }

  function onWfhCancelled(result) {
    if (result?.removed) {
      myLeavesQ.setData((prev) => (prev ?? []).filter((l) => l.id !== result.id))
    } else {
      myLeavesQ.setData((prev) => (prev ?? []).map((l) => (l.id === result.id ? result : l)))
    }
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
      const noun =
        kind === 'wfh'
          ? 'work-from-home request'
          : kind === 'regularize'
            ? 'attendance fix — that day now counts as present'
            : 'leave'
      toast.success(
        outcome === 'approved'
          ? `Approved ${employeeName}'s ${noun}.${kind === 'leave' ? ' Their balance has been updated.' : ''}`
          : `Rejected ${employeeName}'s ${noun.split(' — ')[0]}.`,
      )
      // A decision changes company-wide data; refresh anything already on screen.
      if (allLeavesQ.data !== null) allLeavesQ.reload()
      refreshUser()
    },
    [pendingQ, allLeavesQ, toast, refreshUser],
  )

  /** Opens the profile page — your own (id omitted) or, for an admin, anyone else's. */
  function openProfile(id = null) {
    setNavOpen(false) // reachable from the drawer's mini-profile
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
  const nav = navFor(role, { notifications: notifCount, approvals: pending.length })
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
    markNotificationsSeen()
    setShowNotifications(true)
  }

  return (
    <div
      className={`emp${collapsed ? ' emp--collapsed' : ''}${navOpen ? ' emp--nav-open' : ''}`}
      data-role={role}
      data-theme={theme || undefined}
    >
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
        mobileOpen={navOpen}
        onCloseMobile={closeNav}
      />

      {/* ---------------- Main ---------------- */}
      <div className="emp__main">
        <TopBar
          dateLabel={dateLabel}
          title={activeLabel}
          onMenuClick={() => setNavOpen((o) => !o)}
          menuOpen={navOpen}
          greeting={active === 'dashboard' ? `Good to see you, ${firstName}` : undefined}
          searchable={isSearchable}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={SEARCHABLE_TABS[active]}
          notificationCount={notifCount}
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

              {/* Pending approvals (left) and documents (right) share one
                  row; employees have no approvals card, so theirs renders
                  full-width via the .dash-duo--single variant. */}
              <div className={`dash-duo${isManager ? '' : ' dash-duo--single'}`}>
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

                <DocumentsCard
                  userId={user?.id}
                  canUpload
                  canDelete={role === 'admin'}
                  title="My documents"
                />
              </div>
            </>
          )}

          {active === 'notifications' && (
            <NotificationsPage
              query={announcementsQ}
              onMarkedRead={onAnnouncementsRead}
              onRemoved={onAnnouncementRemoved}
              approvalsPending={pending}
              myPendingLeaves={myPendingLeaves}
              recentDecisions={myRecentDecisions}
              typeLabels={typeLabels}
              currentUserId={user?.id}
              role={role}
              onViewApprovals={() => selectTab('approvals')}
              onViewLeaves={() => selectTab('leaves')}
            />
          )}

          {active === 'attendance' && (
            <div className="single-col">
              <AttendanceCard onChange={refreshAfterAttendance} />
              <Section query={analyticsQ} skeletonRows={4}>
                {analyticsQ.data && <AttendanceAnalytics data={analyticsQ.data} />}
              </Section>
              <Section query={historyQ} skeletonRows={5}>
                <AttendanceHistory
                  rows={history}
                  regularize={myRegularize}
                  onRegularized={onRegularizeCreated}
                />
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

              {/* Approved time off that hasn't started yet — moved here from
                  the Notifications feed, where it lived as "Coming up". */}
              <UpcomingLeaves upcoming={myUpcoming} typeLabels={typeLabels} />

              {/* Lower card — request history: leave (left) and WFH (right). */}
              <section className="card leaves-duo pop" style={{ '--d': '510ms' }}>
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

          {active === 'org' && canAccess(role, 'org') && (
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

          {active === 'othersettings' && canAccess(role, 'othersettings') && (
            <div className="single-col">
              <OtherSettingsManager query={settingsQ} />
            </div>
          )}

          {active === 'systemlogs' && canAccess(role, 'systemlogs') && (
            <div className="single-col">
              <SystemLogs />
            </div>
          )}

          {/* Feedback / HR Request — the configured form, embedded as a full
              in-app page (no popup). key remounts the iframe when hopping
              between the two so stale form state never carries over. */}
          {FORM_LINKS[active] && canAccess(role, active) && (
            <div className="single-col">
              <Section query={settingsQ} skeletonRows={4}>
                <FormLinkSection
                  key={active}
                  title={FORM_LINKS[active].title}
                  noun={FORM_LINKS[active].noun}
                  url={settingsQ.data?.[FORM_LINKS[active].field] ?? ''}
                  isAdmin={role === 'admin'}
                  onOpenSettings={() => selectTab('othersettings')}
                />
              </Section>
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
