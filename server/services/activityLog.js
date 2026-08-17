/**
 * The user-activity audit layer: "what did people actually DO in the HRMS".
 *
 * This is deliberately a SECOND, independent trail alongside
 * middleware/requestLog.js, not a prettier view of it:
 *
 *   request_logs  — one row per HTTP call. Automatic, exhaustive, technical.
 *                   Answers "what did the system do?"
 *   activity_logs — one row per meaningful action, written explicitly by the
 *                   route that performs it. Answers "what did people do?"
 *
 * They can't be derived from each other. One action ("approve this leave")
 * produces several requests, only one of which is the action; and the sentence
 * an HR admin needs — *whose* leave, which type, which dates — exists only
 * inside the handler, where the records are already loaded. Recording at the
 * call site is what makes the description accurate; a middleware could only
 * ever guess it back from a URL.
 *
 * ── Adding a new activity ────────────────────────────────────────────────
 *   1. add a key to ACTIVITY_TYPES below (category + label + icon)
 *   2. call recordActivity(req, '<key>', { … }) from the route, AFTER the
 *      write has succeeded
 * That's the whole extension surface — no schema change, no UI change: the
 * Activity Logs page builds its category filter from this registry.
 */
import { q } from '../db.js'
import { clientIp } from './geoip.js'

/** Retention. Far longer than request_logs' 30 days: this is an audit trail,
 *  it's low-volume (one row per real action, not per HTTP call), and "who
 *  approved that leave in March" is exactly the question it exists to answer. */
const RETENTION_DAYS = 365

/**
 * Every activity the app can record. `category` groups them in the UI filter,
 * `label` is the short action name shown in the table's Action column, and
 * `icon` is a key from src/components/Icon.jsx.
 *
 * Categories are the ones this codebase actually has. There is no Departments
 * or Roles entity to audit — `department` is a free-text field on a user, and
 * "roles" are the fixed employee/manager/admin enum — so role changes live
 * under Employee Management and named groups under Teams, rather than
 * inventing categories with nothing behind them.
 */
export const ACTIVITY_TYPES = {
  // ── Authentication ──
  'auth.login': { category: 'Authentication', label: 'Signed in', icon: 'logout' },
  'auth.login_failed': { category: 'Authentication', label: 'Sign-in failed', icon: 'alertTriangle' },
  'auth.logout': { category: 'Authentication', label: 'Signed out', icon: 'logout' },
  'auth.registered': { category: 'Authentication', label: 'Account activated', icon: 'user' },
  'auth.password_reset_requested': { category: 'Authentication', label: 'Password reset requested', icon: 'mail' },
  'auth.password_reset': { category: 'Authentication', label: 'Password changed', icon: 'check' },

  // ── Employee Management ──
  'employee.created': { category: 'Employee Management', label: 'Employee added', icon: 'users' },
  'employee.invited': { category: 'Employee Management', label: 'Invite re-sent', icon: 'mail' },
  'employee.role_changed': { category: 'Employee Management', label: 'Role changed', icon: 'idCard' },
  'employee.manager_changed': { category: 'Employee Management', label: 'Manager changed', icon: 'tree' },
  'employee.profile_updated': { category: 'Employee Management', label: 'Employee record updated', icon: 'edit' },

  // ── Leave Management ──
  'leave.applied': { category: 'Leave Management', label: 'Leave applied', icon: 'leaf' },
  'wfh.applied': { category: 'Leave Management', label: 'WFH requested', icon: 'home' },
  'regularize.applied': { category: 'Leave Management', label: 'Attendance fix requested', icon: 'clock' },
  'leave.approved': { category: 'Leave Management', label: 'Request approved', icon: 'check' },
  'leave.rejected': { category: 'Leave Management', label: 'Request rejected', icon: 'x' },
  'leave.cancelled': { category: 'Leave Management', label: 'Request cancelled', icon: 'x' },

  // ── Attendance ── (check-in/out only; pause/resume is noise in an audit trail)
  'attendance.checked_in': { category: 'Attendance', label: 'Checked in', icon: 'clock' },
  'attendance.checked_out': { category: 'Attendance', label: 'Checked out', icon: 'clock' },

  // ── Announcements ──
  'announcement.created': { category: 'Announcements', label: 'Announcement posted', icon: 'megaphone' },
  'announcement.deleted': { category: 'Announcements', label: 'Announcement removed', icon: 'trash' },

  // ── Teams ──
  'team.created': { category: 'Teams', label: 'Team created', icon: 'users' },
  'team.updated': { category: 'Teams', label: 'Team updated', icon: 'users' },
  'team.deleted': { category: 'Teams', label: 'Team deleted', icon: 'trash' },

  // ── Documents ──
  'document.uploaded': { category: 'Documents', label: 'Document uploaded', icon: 'upload' },
  'document.downloaded': { category: 'Documents', label: 'Document downloaded', icon: 'download' },
  'document.deleted': { category: 'Documents', label: 'Document deleted', icon: 'trash' },

  // ── Policies ──
  'leave_type.created': { category: 'Policies', label: 'Leave type created', icon: 'sliders' },
  'leave_type.updated': { category: 'Policies', label: 'Leave type updated', icon: 'sliders' },
  'employment_type.created': { category: 'Policies', label: 'Employment type created', icon: 'sliders' },
  'employment_type.updated': { category: 'Policies', label: 'Employment type updated', icon: 'sliders' },
  'employment_type.deleted': { category: 'Policies', label: 'Employment type deleted', icon: 'trash' },

  // ── Settings ──
  'settings.updated': { category: 'Settings', label: 'Settings changed', icon: 'settings' },
  'profile.updated': { category: 'Settings', label: 'Profile updated', icon: 'user' },
}

/** Distinct categories, in registry order — drives the UI's filter dropdown. */
export const ACTIVITY_CATEGORIES = [...new Set(Object.values(ACTIVITY_TYPES).map((t) => t.category))]

/** Mirror the varchar caps in schema.js so an oversized value truncates
 *  instead of failing the insert and losing the row (same as requestLog). */
const trunc = (v, n) => (v == null ? null : String(v).slice(0, n))

/**
 * Record one meaningful action. Fire-and-forget by design: an audit write must
 * never fail, slow, or roll back the operation it describes — a dropped log
 * line is bad, a failed leave approval because logging hiccuped is worse.
 *
 * Call it AFTER the write succeeds, so the trail only ever contains things
 * that actually happened.
 *
 * @param {object} req                Express request — supplies actor + IP
 * @param {keyof ACTIVITY_TYPES} action
 * @param {object} [opts]
 * @param {string} [opts.description] the human sentence; falls back to "<Actor> <label>"
 * @param {string} [opts.targetType]  'employee' | 'leave' | 'announcement' | …
 * @param {string} [opts.targetId]    uuid of the thing acted on, when there is one
 * @param {string} [opts.targetName]  how to name it in the UI
 * @param {'success'|'failed'} [opts.status]
 * @param {{id?:string,name?:string,email?:string,role?:string}} [opts.actor]
 *        overrides req.user — needed for actions with no session yet
 *        (a failed sign-in, activating an invite, resetting a password).
 */
export function recordActivity(req, action, opts = {}) {
  const type = ACTIVITY_TYPES[action]
  if (!type) {
    // A typo'd key would otherwise write an uncategorised row that no filter
    // can reach. Loud in the server log, still harmless to the request.
    console.warn(`[activity] unknown action "${action}" — add it to ACTIVITY_TYPES`)
    return
  }

  const actor = opts.actor ?? req?.user ?? {}
  const actorName = actor.name || actor.email || 'Someone'
  const description = opts.description || `${actorName} — ${type.label.toLowerCase()}`

  q(
    `insert into activity_logs
       (actor_id, actor_name, actor_email, actor_role, action, category,
        description, target_type, target_id, target_name, status, ip)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      actor.id ?? null,
      trunc(actorName, 160),
      trunc(actor.email, 254),
      trunc(actor.role, 20),
      trunc(action, 60),
      trunc(type.category, 40),
      trunc(description, 500),
      trunc(opts.targetType ?? '', 40),
      opts.targetId ?? null,
      trunc(opts.targetName ?? '', 200),
      opts.status === 'failed' ? 'failed' : 'success',
      trunc(req ? clientIp(req) : null, 64),
    ],
  ).catch((err) => {
    console.error('[activity] failed to record', action, '-', err.message)
  })
}

/** Drop entries past the retention window. Called from the read endpoint, the
 *  same deterministic-sweep-on-read approach request_logs uses (no cron on the
 *  free tier). */
export async function sweepActivityLogs() {
  await q(`delete from activity_logs where ts < now() - make_interval(days => $1)`, [
    RETENTION_DAYS,
  ])
}

export const ACTIVITY_RETENTION_DAYS = RETENTION_DAYS
