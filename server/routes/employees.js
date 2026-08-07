import { Router } from 'express'
import { q } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import {
  isValidId,
  mapUser,
  safeUserJSON,
  profileUserJSON,
  nextEmployeeId,
  findUserById,
  newInviteToken,
  INVITE_TTL_MS,
} from '../store.js'
import { isRunning } from '../services/attendance.js'
import { dayKey } from '../utils/time.js'

const router = Router()
router.use(requireAuth)

const PHONE_RE = /^[0-9+\-\s()]{7,20}$/
const AADHAR_RE = /^\d{12}$/
// Base64 inflates size ~4/3 — this caps the decoded image around ~1MB.
const MAX_PHOTO_DATA_URL_LENGTH = 1_400_000
const PHOTO_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,/i

/**
 * Coarse presence for everyone, derived from today's work sessions — there is no
 * separate presence store, the attendance timer *is* the signal.
 *
 *   online  — checked in and the timer is running
 *   idle    — checked in but paused (on a break)
 *   offline — not checked in yet, or already checked out / auto-closed
 *
 * Deliberately coarse: this endpoint is readable by every role, so it exposes a
 * single enum and never worked hours, check-in times or session internals.
 * Scoped to today's dayKey, so stale sessions from previous days can't leak.
 * @returns {Promise<Map<string, 'online'|'idle'|'offline'>>} keyed by user id
 */
async function activityByUser() {
  const { rows } = await q('select user_id, events, status from work_sessions where date = $1', [
    dayKey(),
  ])
  const map = new Map()
  for (const s of rows) {
    const open = s.status === 'active'
    map.set(s.user_id, !open ? 'offline' : isRunning(s.events) ? 'online' : 'idle')
  }
  return map
}

/**
 * GET /api/employees/org-tree — the whole reporting structure as a nested tree.
 * Admin only (org visibility for other roles is paused — restore by dropping
 * the requireRole below and re-adding 'org' to Portal's ROLE_SECTIONS). Built
 * purely from the manager_id self-reference; roots are people with no manager
 * (e.g. admins). Each node also carries a coarse `activity` state for the
 * presence dot.
 */
router.get('/org-tree', requireRole('admin'), async (_req, res, next) => {
  try {
    const [{ rows: users }, activity] = await Promise.all([
      q('select id, name, designation, department, role, manager_id from users'),
      activityByUser(),
    ])
    const nodes = new Map()
    for (const u of users) {
      nodes.set(u.id, {
        id: u.id,
        name: u.name,
        designation: u.designation,
        department: u.department,
        role: u.role,
        managerId: u.manager_id,
        activity: activity.get(u.id) ?? 'offline',
        reports: [],
      })
    }
    const roots = []
    for (const node of nodes.values()) {
      const parent = node.managerId && nodes.get(node.managerId)
      if (parent) parent.reports.push(node)
      else roots.push(node)
    }
    res.json({ roots })
  } catch (err) {
    next(err)
  }
})

/** Load a user plus resolved manager/employment-type display names. */
async function loadUserWithNames(id) {
  const { rows } = await q(
    `select u.*, m.name as manager_name, et.name as employment_type_name
       from users u
       left join users m on m.id = u.manager_id
       left join employment_types et on et.id = u.employment_type_id
      where u.id = $1`,
    [id],
  )
  return rows[0] ?? null
}

/**
 * GET /api/employees/:id/profile — full personal profile (DOB, address,
 * phone, education, Aadhar) that org-tree/list endpoints deliberately omit.
 * Only the person themselves or an admin may view it.
 */
router.get('/:id/profile', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid employee id.' })
    }
    const isSelf = req.params.id === req.user.id
    if (!isSelf && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You do not have access to this resource.' })
    }

    const target = await loadUserWithNames(req.params.id)
    if (!target) return res.status(404).json({ error: 'Employee not found.' })

    res.json({
      ...profileUserJSON(mapUser(target)),
      managerName: target.manager_name ?? null,
      employmentTypeName: target.employment_type_name ?? null,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/employees/:id/profile — update personal details. Self may edit
 * their own; admin may edit anyone's. Deliberately whitelists only the
 * personal fields below — role, manager and email changes go through their
 * own, separately-audited endpoints, never this one.
 */
router.patch('/:id/profile', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid employee id.' })
    }
    const isSelf = req.params.id === req.user.id
    if (!isSelf && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You do not have access to this resource.' })
    }

    const target = await loadUserWithNames(req.params.id)
    if (!target) return res.status(404).json({ error: 'Employee not found.' })
    const managerName = target.manager_name ?? null
    // May be overwritten below if employmentType actually changes.
    let employmentTypeName = target.employment_type_name ?? null

    const { dob, address, phone, education, aadharNumber, photoUrl, employmentType } = req.body || {}

    const sets = []
    const params = []
    const set = (column, value) => {
      params.push(value)
      sets.push(`${column} = $${params.length}`)
    }

    if (dob !== undefined) {
      if (dob) {
        const parsed = new Date(dob)
        if (Number.isNaN(parsed.getTime()) || parsed > new Date()) {
          return res.status(400).json({ error: 'Enter a valid date of birth.' })
        }
        set('dob', parsed)
      } else {
        set('dob', null)
      }
    }

    if (address !== undefined) {
      const trimmed = String(address).trim()
      if (trimmed.length > 300) {
        return res.status(400).json({ error: 'Address must be under 300 characters.' })
      }
      set('address', trimmed)
    }

    if (phone !== undefined) {
      const trimmed = String(phone).trim()
      if (trimmed && !PHONE_RE.test(trimmed)) {
        return res.status(400).json({ error: 'Enter a valid phone number.' })
      }
      set('phone', trimmed)
    }

    if (education !== undefined) {
      const trimmed = String(education).trim()
      if (trimmed.length > 500) {
        return res.status(400).json({ error: 'Education must be under 500 characters.' })
      }
      set('education', trimmed)
    }

    if (aadharNumber !== undefined) {
      const digits = String(aadharNumber).replace(/\D/g, '')
      if (digits && !AADHAR_RE.test(digits)) {
        return res.status(400).json({ error: 'Aadhar number must be exactly 12 digits.' })
      }
      set('aadhar_number', digits)
    }

    if (photoUrl !== undefined) {
      const trimmed = String(photoUrl).trim()
      if (trimmed) {
        if (trimmed.length > MAX_PHOTO_DATA_URL_LENGTH) {
          return res.status(400).json({ error: 'That image is too large. Please use one under ~1MB.' })
        }
        if (!PHOTO_DATA_URL_RE.test(trimmed)) {
          return res.status(400).json({ error: 'Unsupported image format.' })
        }
      }
      set('photo_url', trimmed)
    }

    // Employment classification — HR data, not a personal detail, so unlike
    // every field above this is admin-only even when editing your own
    // profile. Only reseeds leave_quotas/leave_balances when the value
    // actually CHANGES (never on "field present but same as today"), so an
    // unrelated profile save can never silently reset someone's balance —
    // the frontend is expected to confirm this with the admin first, since
    // it discards any unused balance under the previous policy.
    if (employmentType !== undefined) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only an admin can change employment type.' })
      }
      const currentId = target.employment_type_id
      const nextId = employmentType || null
      if (nextId && !isValidId(nextId)) {
        return res.status(400).json({ error: 'Invalid employment type id.' })
      }
      if (nextId !== currentId) {
        let nextType = null
        if (nextId) {
          const { rows } = await q('select * from employment_types where id = $1', [nextId])
          nextType = rows[0]
          if (!nextType) return res.status(400).json({ error: 'Selected employment type does not exist.' })
        }
        const quotas = JSON.stringify(nextType?.quotas || {})
        set('employment_type_id', nextId)
        set('leave_quotas', quotas)
        set('leave_balances', quotas)
        employmentTypeName = nextType?.name ?? null
      }
    }

    let updated = target
    if (sets.length) {
      params.push(req.params.id)
      const { rows } = await q(
        `update users set ${sets.join(', ')} where id = $${params.length} returning *`,
        params,
      )
      updated = rows[0]
    }
    res.json({ ...profileUserJSON(mapUser(updated)), managerName, employmentTypeName })
  } catch (err) {
    next(err)
  }
})

// Everything below is admin-only.
router.use(requireRole('admin'))

/** GET /api/employees — list everyone (admin view), with manager names. */
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await q(
      `select u.*, m.name as manager_name, et.name as employment_type_name
         from users u
         left join users m on m.id = u.manager_id
         left join employment_types et on et.id = u.employment_type_id
        order by u.created_at`,
    )
    res.json(
      rows.map((r) => ({
        ...safeUserJSON(mapUser(r)),
        managerName: r.manager_name ?? null,
        employmentTypeName: r.employment_type_name ?? null,
      })),
    )
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/employees — invite a new employee (no password: they set their
 * own when they register through the invite link).
 * Body: { name, email, role, designation, department, joiningDate, managerId, employmentType }
 * The managerId is what wires this person into the org tree. employmentType
 * (optional) seeds leave_quotas/leave_balances from that policy's quotas —
 * left unassigned, the new hire starts with a zeroed leave balance until an
 * admin assigns one via their profile.
 *
 * Creates the account with status 'invited' and returns `inviteToken` — the
 * ONE time the raw token is ever available (the DB stores only its hash), so
 * the admin must copy the invite link now or regenerate it later via
 * POST /:id/invite. The invited person completes registration at
 * /signup?token=... (routes/auth.js), which activates the account.
 */
router.post('/', async (req, res, next) => {
  try {
    const {
      name,
      email,
      role = 'employee',
      designation = '',
      department = '',
      joiningDate,
      managerId = null,
      employmentType = null,
    } = req.body || {}

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required.' })
    }
    if (!['employee', 'manager', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' })
    }
    const normEmail = String(email).trim().toLowerCase()
    const { rows: emailTaken } = await q('select 1 from users where email = $1', [normEmail])
    if (emailTaken.length) {
      return res.status(409).json({ error: 'An account with that email already exists.' })
    }
    if (managerId && !(await findUserById(managerId))) {
      return res.status(400).json({ error: 'Selected manager does not exist.' })
    }
    let employmentTypeRow = null
    if (employmentType) {
      if (!isValidId(employmentType)) {
        return res.status(400).json({ error: 'Invalid employment type.' })
      }
      const { rows } = await q('select * from employment_types where id = $1', [employmentType])
      employmentTypeRow = rows[0]
      if (!employmentTypeRow) return res.status(400).json({ error: 'Selected employment type does not exist.' })
    }
    const quotas = JSON.stringify(employmentTypeRow?.quotas || {})
    const invite = newInviteToken()

    const { rows } = await q(
      `insert into users (name, email, employee_id, password_hash, status, invite_token_hash,
                          invite_expires_at, role, designation, department, joining_date,
                          manager_id, employment_type_id, leave_quotas, leave_balances)
       values ($1, $2, $3, null, 'invited', $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
       returning *`,
      [
        String(name).trim(),
        normEmail,
        await nextEmployeeId(),
        invite.tokenHash,
        new Date(Date.now() + INVITE_TTL_MS),
        role,
        String(designation).trim(),
        String(department).trim(),
        joiningDate ? new Date(joiningDate) : null,
        managerId || null,
        employmentTypeRow?.id ?? null,
        quotas,
      ],
    )
    res.status(201).json({
      ...safeUserJSON(mapUser(rows[0])),
      managerName: null,
      employmentTypeName: employmentTypeRow?.name ?? null,
      inviteToken: invite.token,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/employees/:id/invite — issue a fresh invite link for a pending
 * account (the raw token from creation is shown only once, and links expire).
 * Refused for active accounts: regenerating an invite for someone who already
 * set a password would be an account-takeover vector, not a convenience.
 */
router.post('/:id/invite', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid employee id.' })
    }
    const user = await findUserById(req.params.id)
    if (!user) return res.status(404).json({ error: 'Employee not found.' })
    if (user.status !== 'invited') {
      return res.status(409).json({ error: `${user.name} has already registered their account.` })
    }

    const invite = newInviteToken()
    await q('update users set invite_token_hash = $1, invite_expires_at = $2 where id = $3', [
      invite.tokenHash,
      new Date(Date.now() + INVITE_TTL_MS),
      user.id,
    ])
    res.json({ inviteToken: invite.token })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/employees/:id/role — promote or demote someone (admin-only, like
 * everything below the requireRole gate above). Supports the "player-coach"
 * lifecycle: an employee is promoted to manager while new hires report to
 * them, then demoted back once the project wraps.
 *
 * Guards:
 *  - Admins can't change their OWN role — prevents the last admin from
 *    locking themselves out of this very screen.
 *  - Demotion to employee is refused while the person still has direct
 *    reports: approvals are strictly direct-manager-only (see leaves.js),
 *    so an employee "manager" would strand their team's pending requests
 *    with nobody — not even an admin — able to decide them.
 */
router.patch('/:id/role', async (req, res, next) => {
  try {
    const { role } = req.body || {}
    if (!['employee', 'manager', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' })
    }
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid employee id.' })
    }
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role.' })
    }

    const user = await findUserById(req.params.id)
    if (!user) return res.status(404).json({ error: 'Employee not found.' })
    if (user.role === role) return res.json(safeUserJSON(user))

    if (role === 'employee') {
      const { rows } = await q('select count(*)::int as n from users where manager_id = $1', [
        user.id,
      ])
      const reports = rows[0].n
      if (reports > 0) {
        return res.status(409).json({
          error: `${user.name} still manages ${reports} ${reports === 1 ? 'person' : 'people'} — reassign them to another manager first.`,
        })
      }
    }

    const { rows } = await q('update users set role = $1 where id = $2 returning *', [
      role,
      user.id,
    ])
    res.json(safeUserJSON(mapUser(rows[0])))
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/employees/:id/manager — reassign someone's manager (fix/restructure).
 * Rejects self-management and simple cycles so the tree stays valid.
 */
router.patch('/:id/manager', async (req, res, next) => {
  try {
    const { managerId } = req.body || {}
    const user = await findUserById(req.params.id)
    if (!user) return res.status(404).json({ error: 'Employee not found.' })

    if (managerId) {
      if (managerId === req.params.id) {
        return res.status(400).json({ error: 'An employee cannot manage themselves.' })
      }
      const manager = await findUserById(managerId)
      if (!manager) return res.status(400).json({ error: 'Selected manager does not exist.' })
      // Walk up the proposed manager's chain to make sure we don't form a cycle.
      let cursor = manager
      const seen = new Set([req.params.id])
      while (cursor) {
        if (seen.has(cursor.id)) {
          return res.status(400).json({ error: 'That change would create a reporting loop.' })
        }
        seen.add(cursor.id)
        cursor = cursor.managerId ? await findUserById(cursor.managerId) : null
      }
    }

    const { rows } = await q('update users set manager_id = $1 where id = $2 returning *', [
      managerId || null,
      user.id,
    ])
    res.json(safeUserJSON(mapUser(rows[0])))
  } catch (err) {
    next(err)
  }
})

export default router
