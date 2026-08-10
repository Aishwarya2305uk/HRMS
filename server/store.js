import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { q } from './db.js'
import { cachedLeaveTypes, cachedEmploymentTypes } from './cache.js'

/**
 * Shared row→object mapping and cross-cutting user helpers. Postgres rows are
 * snake_case; everything the rest of the server (and the client) touches is
 * camelCase, converted exactly once, here.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Every id in this codebase is a Postgres uuid — validate before querying. */
export function isValidId(id) {
  return typeof id === 'string' && UUID_RE.test(id)
}

/** users row → internal camelCase user (includes passwordHash — never send raw). */
export function mapUser(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    employeeId: r.employee_id,
    passwordHash: r.password_hash,
    status: r.status ?? 'active',
    inviteExpiresAt: r.invite_expires_at ?? null,
    role: r.role,
    designation: r.designation,
    department: r.department,
    joiningDate: r.joining_date,
    managerId: r.manager_id,
    employmentTypeId: r.employment_type_id,
    photoUrl: r.photo_url,
    dob: r.dob,
    address: r.address,
    phone: r.phone,
    education: r.education,
    aadharNumber: r.aadhar_number,
    leaveBalances: r.leave_balances || {},
    leaveQuotas: r.leave_quotas || {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const sumDays = (obj) => Object.values(obj || {}).reduce((s, v) => s + (Number(v) || 0), 0)

/** Shape sent to the client — never includes the hash. */
export function safeUserJSON(u) {
  return {
    id: u.id,
    employeeId: u.employeeId || null,
    name: u.name,
    email: u.email,
    status: u.status ?? 'active',
    role: u.role,
    designation: u.designation,
    department: u.department,
    joiningDate: u.joiningDate,
    photoUrl: u.photoUrl || '',
    managerId: u.managerId || null,
    // Historical API key name; the value is the employment type's id.
    employmentType: u.employmentTypeId || null,
    leaveBalances: u.leaveBalances || {},
    leaveBalance: sumDays(u.leaveBalances),
    leaveQuotaTotal: sumDays(u.leaveQuotas),
  }
}

/**
 * Full personal profile — everything safeUserJSON has plus PII it
 * deliberately omits. Callers MUST authorize the viewer (self or admin)
 * before calling this; the function itself assumes that already happened.
 */
export function profileUserJSON(u) {
  return {
    ...safeUserJSON(u),
    dob: u.dob ?? null,
    address: u.address || '',
    phone: u.phone || '',
    education: u.education || '',
    aadharNumber: u.aadharNumber || '',
  }
}

/** Load one user by id (uuid). Returns the mapped user or null. */
export async function findUserById(id, client = null) {
  if (!isValidId(id)) return null
  const { rows } = await (client ?? { query: q }).query('select * from users where id = $1', [id])
  return rows[0] ? mapUser(rows[0]) : null
}

export async function findUserByEmail(email) {
  const { rows } = await q('select * from users where email = $1', [
    String(email).trim().toLowerCase(),
  ])
  return rows[0] ? mapUser(rows[0]) : null
}

export function hashPassword(plain) {
  return bcrypt.hash(plain, 10)
}

export function comparePassword(plain, passwordHash) {
  // Invited accounts have no hash yet — bcrypt.compare would throw on null.
  if (!passwordHash) return Promise.resolve(false)
  return bcrypt.compare(plain, passwordHash)
}

/**
 * Invite tokens for admin-created accounts: the raw token lives only in the
 * invite link the admin shares; the database stores its SHA-256 hash, so a
 * leaked users table can't be turned into working invite links.
 */
export function newInviteToken() {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInviteToken(token) }
}

export function hashInviteToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

/** How long an invite link stays valid. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Look up a *pending, unexpired* invite by its raw token. Null otherwise. */
export async function findPendingInviteByToken(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null
  const { rows } = await q(
    `select * from users
      where invite_token_hash = $1 and status = 'invited' and invite_expires_at > now()`,
    [hashInviteToken(token)],
  )
  return rows[0] ? mapUser(rows[0]) : null
}

/**
 * Password-reset tokens reuse the invite scheme wholesale (256-bit raw token
 * only ever inside the emailed link, SHA-256 hash at rest) — just different
 * columns and a much shorter life, since a reset link is acted on within
 * minutes while an invite may sit in an inbox for days.
 */
export const RESET_TTL_MS = 60 * 60 * 1000 // 1 hour

/** Look up an *active* account by an unexpired reset token. Null otherwise. */
export async function findUserByResetToken(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null
  const { rows } = await q(
    `select * from users
      where reset_token_hash = $1 and status = 'active' and reset_expires_at > now()`,
    [hashInviteToken(token)],
  )
  return rows[0] ? mapUser(rows[0]) : null
}

/**
 * Next unused "EMP###" code. Scans existing codes for the highest numeric
 * suffix rather than keeping a counter — user creation is rare and
 * admin-only, so a scan is simpler than a sequence to bootstrap. Pads to 3
 * digits but keeps growing past EMP999 (EMP1000, ...).
 */
export async function nextEmployeeId() {
  const { rows } = await q(String.raw`select employee_id from users where employee_id ~ '^EMP\d+$'`)
  const max = rows.reduce((m, r) => Math.max(m, Number(r.employee_id.slice(3))), 0)
  return `EMP${String(max + 1).padStart(3, '0')}`
}

/**
 * Fills gaps in leaveBalances for any currently-active LeaveType this user
 * doesn't yet have an entry for (e.g. an admin added a new leave type after
 * this person was hired) — pulling the gap-fill amount from their CURRENT
 * employment type's quota, or 0 if unassigned. Mutates u.leaveBalances and
 * returns { merged, changed }; the CALLER decides whether to persist.
 */
export async function ensureLeaveBalances(u) {
  // Reference data comes from the read-through cache (see cache.js) — this
  // runs on every /auth/me, so skipping two Postgres round-trips matters.
  const [allTypes, allEmploymentTypes] = await Promise.all([
    cachedLeaveTypes(),
    u.employmentTypeId ? cachedEmploymentTypes() : null,
  ])
  const activeTypes = allTypes.filter((t) => t.active)
  const employmentType = allEmploymentTypes?.find((t) => t.id === u.employmentTypeId) ?? null
  const quotas = employmentType?.quotas || {}
  const merged = { ...(u.leaveBalances || {}) }
  let changed = false
  for (const t of activeTypes) {
    if (merged[t.key] === undefined) {
      merged[t.key] = Number(quotas[t.key]) || 0
      changed = true
    }
  }
  u.leaveBalances = merged
  return { merged, changed }
}

/** Persist a user's leaveBalances map wholesale. */
export function saveLeaveBalances(userId, balances, client = null) {
  return (client ?? { query: q }).query('update users set leave_balances = $1 where id = $2', [
    JSON.stringify(balances),
    userId,
  ])
}

// ---- client-facing shapes for the other entities ----

/**
 * leaves row → client JSON. Requester identity comes from join aliases
 * (u.name as employee_name, u.email as employee_email, u.employee_id as
 * employee_code) when the query provides them.
 */
export function leaveJSON(r) {
  return {
    id: r.id,
    userId: r.user_id,
    employeeName: r.employee_name ?? null,
    employeeId: r.employee_code ?? null,
    employeeEmail: r.employee_email ?? null,
    kind: r.kind,
    type: r.type ?? null,
    startDate: r.start_date,
    endDate: r.end_date,
    dayPart: r.day_part ?? 'full',
    startTime: r.start_time || null,
    endTime: r.end_time || null,
    days: r.days,
    reason: r.reason,
    status: r.status,
    approverId: r.approver_id || null,
    decidedAt: r.decided_at,
    decisionComment: r.decision_comment,
    cancelReason: r.cancel_reason ?? '',
    cancelledAt: r.cancelled_at ?? null,
    createdAt: r.created_at,
  }
}

export function leaveTypeJSON(r) {
  return { id: r.id, key: r.key, label: r.label, active: r.active }
}

export function employmentTypeJSON(r) {
  return { id: r.id, name: r.name, quotas: r.quotas || {} }
}

/** teams row → client JSON. `members` (id+name) is attached by routes that join. */
export function teamJSON(r) {
  return {
    id: r.id,
    name: r.name,
    managerId: r.manager_id,
    memberIds: r.member_ids || [],
    memberCount: (r.member_ids || []).length,
    createdAt: r.created_at,
  }
}

/** announcements row → client JSON. Names come from join aliases when present. */
export function announcementJSON(r) {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    type: r.type,
    authorId: r.author_id,
    authorName: r.author_name ?? null,
    audienceScope: r.audience_scope,
    audienceRole: r.audience_role,
    audienceRootId: r.audience_root_id ?? null,
    audienceRootName: r.audience_root_name ?? null,
    audienceGroupId: r.audience_group_id ?? null,
    audienceGroupName: r.audience_group_name ?? null,
    createdAt: r.created_at,
  }
}

/** documents row → listing shape, deliberately WITHOUT data_url. */
export function documentJSON(r) {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    mimeType: r.mime_type,
    size: r.size,
    uploadedByName: r.uploaded_by_name ?? null,
    createdAt: r.created_at,
  }
}

export function settingsJSON(r) {
  return { feedbackFormUrl: r.feedback_form_url, hrRequestFormUrl: r.hr_request_form_url }
}
