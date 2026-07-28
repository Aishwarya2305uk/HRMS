/**
 * Typed-ish helpers for every HRMS endpoint, grouped by resource. Thin wrappers
 * over apiFetch so components read like `attendance.action('check-in')`.
 */
import { apiFetch } from './api'

export const attendance = {
  today: () => apiFetch('/attendance/today'),
  action: (a) => apiFetch(`/attendance/${a}`, { method: 'POST' }),
  history: () => apiFetch('/attendance/history'),
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
  setManager: (id, managerId) =>
    apiFetch(`/employees/${id}/manager`, { method: 'PATCH', body: { managerId } }),
  profile: (id) => apiFetch(`/employees/${id}/profile`),
  updateProfile: (id, body) => apiFetch(`/employees/${id}/profile`, { method: 'PATCH', body }),
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
