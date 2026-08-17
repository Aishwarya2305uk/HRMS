/**
 * Typed-ish helpers for every HRMS endpoint, grouped by resource. Thin wrappers
 * over apiFetch so components read like `attendance.action('check-in')`.
 */
import { apiFetch } from './api'

/** Sign-out. Sessions are stateless JWTs so this only records the event in the
 *  activity trail — the client drops the token regardless of the outcome. */
export const auth = {
  logout: () => apiFetch('/auth/logout', { method: 'POST' }),
}

export const attendance = {
  today: () => apiFetch('/attendance/today'),
  action: (a) => apiFetch(`/attendance/${a}`, { method: 'POST' }),
  /** One-tap "Check in for today" — marks the whole day present (8h), no timer. */
  dayCheckin: () => apiFetch('/attendance/day-checkin', { method: 'POST' }),
  history: () => apiFetch('/attendance/history'),
  analytics: () => apiFetch('/attendance/analytics'),
  /** Manager/admin daily check-in roll-call for one date. The server decides
   *  whose names come back — the whole company for an admin, only the
   *  manager's own reports for a manager. */
  daily: (date) => apiFetch(`/attendance/daily${date ? `?date=${date}` : ''}`),
  all: (month) => apiFetch(`/attendance/all${month ? `?month=${month}` : ''}`),
}

export const leaves = {
  config: () => apiFetch('/leaves/config'),
  apply: (body) => apiFetch('/leaves', { method: 'POST', body }),
  applyWfh: (body) => apiFetch('/leaves/wfh', { method: 'POST', body }),
  /** "Count this short attendance day as present" — body { date, reason }. */
  regularize: (body) => apiFetch('/leaves/regularize', { method: 'POST', body }),
  mine: () => apiFetch('/leaves/mine'),
  pending: () => apiFetch('/leaves/pending'),
  /** Pending: removes the request. Approved (before it starts): flips it to
   *  'cancelled' with the optional reason and refunds the balance. */
  cancel: (id, reason) =>
    apiFetch(`/leaves/${id}`, { method: 'DELETE', body: reason ? { reason } : undefined }),
  approve: (id) => apiFetch(`/leaves/${id}/approve`, { method: 'POST' }),
  reject: (id, comment) => apiFetch(`/leaves/${id}/reject`, { method: 'POST', body: { comment } }),
  all: () => apiFetch('/leaves/all'),
  calendar: (month) => apiFetch(`/leaves/calendar?month=${month}`),
}

export const employees = {
  orgTree: () => apiFetch('/employees/org-tree'),
  list: () => apiFetch('/employees'),
  add: (body) => apiFetch('/employees', { method: 'POST', body }),
  /** Fresh invite link for a still-pending account (admin only). */
  reinvite: (id) => apiFetch(`/employees/${id}/invite`, { method: 'POST' }),
  setManager: (id, managerId) =>
    apiFetch(`/employees/${id}/manager`, { method: 'PATCH', body: { managerId } }),
  setRole: (id, role) => apiFetch(`/employees/${id}/role`, { method: 'PATCH', body: { role } }),
  profile: (id) => apiFetch(`/employees/${id}/profile`),
  updateProfile: (id, body) => apiFetch(`/employees/${id}/profile`, { method: 'PATCH', body }),
}

/** Invite-only registration (public, no auth): the sign-up page resolves the
 *  invite token to a pending account, then completes it with a password. */
export const invites = {
  lookup: (token) =>
    apiFetch(`/auth/invite?token=${encodeURIComponent(token)}`, { auth: false }),
  register: (body) => apiFetch('/auth/register', { method: 'POST', body, auth: false }),
}

/** Self-service password reset (public, no auth): request the emailed link,
 *  resolve it to the account it belongs to, then set the new password. */
export const passwordReset = {
  request: (email) => apiFetch('/auth/forgot', { method: 'POST', body: { email }, auth: false }),
  lookup: (token) => apiFetch(`/auth/reset?token=${encodeURIComponent(token)}`, { auth: false }),
  reset: (body) => apiFetch('/auth/reset', { method: 'POST', body, auth: false }),
}

/** Documents on an employee's HR file. Visibility (self / direct manager /
 *  admin), upload rights (self / admin) and deletion (admin only) are all
 *  enforced server-side — see server/routes/documents.js. */
export const documents = {
  list: (userId) => apiFetch(`/documents/user/${userId}`),
  upload: (userId, body) => apiFetch(`/documents/user/${userId}`, { method: 'POST', body }),
  file: (id) => apiFetch(`/documents/${id}/file`),
  remove: (id) => apiFetch(`/documents/${id}`, { method: 'DELETE' }),
}

export const announcements = {
  list: () => apiFetch('/announcements'),
  sent: () => apiFetch('/announcements/sent'),
  markAllRead: () => apiFetch('/announcements/read-all', { method: 'POST' }),
  audienceOptions: () => apiFetch('/announcements/audience-options'),
  create: (body) => apiFetch('/announcements', { method: 'POST', body }),
  remove: (id) => apiFetch(`/announcements/${id}`, { method: 'DELETE' }),
}

export const teams = {
  mine: () => apiFetch('/teams/mine'),
  candidates: () => apiFetch('/teams/candidates'),
  create: (body) => apiFetch('/teams', { method: 'POST', body }),
  update: (id, body) => apiFetch(`/teams/${id}`, { method: 'PATCH', body }),
  remove: (id) => apiFetch(`/teams/${id}`, { method: 'DELETE' }),
}

/** Fired whenever LeaveTypesManager creates/retires a type, so the sibling
 *  EmploymentTypesManager (a separate fetch, no shared cache) knows to
 *  refresh its quota-matrix columns — both render on the same admin page. */
export const LEAVE_TYPES_CHANGED_EVENT = 'hrms:leave-types-changed'

/** Admin-only: manage the leave types employees can apply for (see leaves.config for the active-only list everyone else uses). */
export const leaveTypes = {
  list: () => apiFetch('/leave-types'),
  create: (body) => apiFetch('/leave-types', { method: 'POST', body }),
  update: (id, body) => apiFetch(`/leave-types/${id}`, { method: 'PATCH', body }),
}

/** Org-wide settings: everyone reads (the sidebar's Feedback / HR Request form
 *  links); only an admin may update, from the Other Settings page. Both rules
 *  are enforced server-side — see server/routes/settings.js. */
export const appSettings = {
  get: () => apiFetch('/settings'),
  update: (body) => apiFetch('/settings', { method: 'PATCH', body }),
}

/** Turns a filter object into a query string, dropping anything that isn't a
 *  real constraint ('' / null / 'all'), so the URL only carries what's set. */
function filterQuery(filters = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '' && value !== 'all') {
      params.set(key, value)
    }
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Admin-only: the Advanced Logs tab — one row per API call, kept 30 days
 *  server-side. The technical half of the audit story. */
export const systemLogs = {
  list: (filters = {}) => apiFetch(`/system-logs${filterQuery(filters)}`),
}

/** Admin-only: the Activity Logs tab — one row per meaningful action a person
 *  took, in plain language, kept a year. A separate trail from systemLogs
 *  above, not a view over it (see server/services/activityLog.js). */
export const activityLogs = {
  list: (filters = {}) => apiFetch(`/activity-logs${filterQuery(filters)}`),
  /** Categories + the people who actually appear in the trail, for the filter bar. */
  filters: () => apiFetch('/activity-logs/filters'),
}

/** Admin-only: manage employment classifications (Intern/Full-time/Part-time/custom) and their per-leave-type quotas. */
export const employmentTypes = {
  list: () => apiFetch('/employment-types'),
  create: (body) => apiFetch('/employment-types', { method: 'POST', body }),
  update: (id, body) => apiFetch(`/employment-types/${id}`, { method: 'PATCH', body }),
  remove: (id) => apiFetch(`/employment-types/${id}`, { method: 'DELETE' }),
}
