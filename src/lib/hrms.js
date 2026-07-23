/**
 * Typed-ish helpers for every HRMS endpoint, grouped by resource. Thin wrappers
 * over apiFetch so components read like `attendance.action('check-in')`.
 */
import { apiFetch } from './api'

export const attendance = {
  today: () => apiFetch('/attendance/today'),
  action: (a) => apiFetch(`/attendance/${a}`, { method: 'POST' }),
  history: () => apiFetch('/attendance/history'),
}

export const leaves = {
  config: () => apiFetch('/leaves/config'),
  apply: (body) => apiFetch('/leaves', { method: 'POST', body }),
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
}

export const announcements = {
  list: () => apiFetch('/announcements'),
  markAllRead: () => apiFetch('/announcements/read-all', { method: 'POST' }),
  audienceOptions: () => apiFetch('/announcements/audience-options'),
  create: (body) => apiFetch('/announcements', { method: 'POST', body }),
  remove: (id) => apiFetch(`/announcements/${id}`, { method: 'DELETE' }),
}
