/**
 * Typed-ish helpers for every HRMS endpoint, grouped by resource. Thin wrappers
 * over apiFetch so components read like `attendance.action('check-in')`.
 */
import { apiFetch } from './api'

export const attendance = {
  today: () => apiFetch('/attendance/today'),
  action: (a) => apiFetch(`/attendance/${a}`, { method: 'POST' }),
  history: () => apiFetch('/attendance/history'),
  analytics: () => apiFetch('/attendance/analytics'),
  all: (month) => apiFetch(`/attendance/all${month ? `?month=${month}` : ''}`),
}

export const leaves = {
  config: () => apiFetch('/leaves/config'),
  apply: (body) => apiFetch('/leaves', { method: 'POST', body }),
  applyWfh: (body) => apiFetch('/leaves/wfh', { method: 'POST', body }),
  mine: () => apiFetch('/leaves/mine'),
  pending: () => apiFetch('/leaves/pending'),
  cancel: (id) => apiFetch(`/leaves/${id}`, { method: 'DELETE' }),
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

/** Admin-only: the System Logs page — one row per API call, kept 30 days
 *  server-side. Filters become query params; empty/'all' values are omitted
 *  so the URL only carries real constraints. */
export const systemLogs = {
  list: (filters = {}) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '' && value !== 'all') {
        params.set(key, value)
      }
    }
    const qs = params.toString()
    return apiFetch(`/system-logs${qs ? `?${qs}` : ''}`)
  },
}

/** Admin-only: manage employment classifications (Intern/Full-time/Part-time/custom) and their per-leave-type quotas. */
export const employmentTypes = {
  list: () => apiFetch('/employment-types'),
  create: (body) => apiFetch('/employment-types', { method: 'POST', body }),
  update: (id, body) => apiFetch(`/employment-types/${id}`, { method: 'PATCH', body }),
  remove: (id) => apiFetch(`/employment-types/${id}`, { method: 'DELETE' }),
}
