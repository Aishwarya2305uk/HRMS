import { Router } from 'express'
import mongoose from 'mongoose'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { User } from '../models/User.js'
import { EmploymentType } from '../models/EmploymentType.js'
import { WorkSession, isRunning } from '../models/WorkSession.js'
import { dayKey } from '../utils/time.js'
import { passwordPolicyError } from '../utils/password.js'

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
  const sessions = await WorkSession.find({ date: dayKey() }).select('userId events status')
  const map = new Map()
  for (const s of sessions) {
    const open = s.status === 'active'
    map.set(s.userId.toString(), !open ? 'offline' : isRunning(s.events) ? 'online' : 'idle')
  }
  return map
}

/**
 * GET /api/employees/org-tree — the whole reporting structure as a nested tree.
 * Admin only (org visibility for other roles is paused — restore by dropping
 * the requireRole below and re-adding 'org' to Portal's ROLE_SECTIONS). Built
 * purely from the managerId self-reference; roots are people with no manager
 * (e.g. admins). Each node also carries a coarse `activity` state for the
 * presence dot.
 */
router.get('/org-tree', requireRole('admin'), async (_req, res, next) => {
  try {
    const [users, activity] = await Promise.all([
      User.find({}).select('name designation department role managerId'),
      activityByUser(),
    ])
    const nodes = new Map()
    for (const u of users) {
      const id = u._id.toString()
      nodes.set(id, {
        id,
        name: u.name,
        designation: u.designation,
        department: u.department,
        role: u.role,
        managerId: u.managerId ? u.managerId.toString() : null,
        activity: activity.get(id) ?? 'offline',
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

/**
 * GET /api/employees/:id/profile — full personal profile (DOB, address,
 * phone, education, Aadhar) that org-tree/list endpoints deliberately omit.
 * Only the person themselves or an admin may view it.
 */
router.get('/:id/profile', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid employee id.' })
    }
    const isSelf = req.params.id === req.user._id.toString()
    if (!isSelf && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You do not have access to this resource.' })
    }

    const target = await User.findById(req.params.id)
      .populate('managerId', 'name')
      .populate('employmentType', 'name')
    if (!target) return res.status(404).json({ error: 'Employee not found.' })

    res.json({
      ...target.toProfileJSON(),
      managerName: target.managerId?.name ?? null,
      employmentTypeName: target.employmentType?.name ?? null,
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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid employee id.' })
    }
    const isSelf = req.params.id === req.user._id.toString()
    if (!isSelf && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You do not have access to this resource.' })
    }

    const target = await User.findById(req.params.id)
      .populate('managerId', 'name')
      .populate('employmentType', 'name')
    if (!target) return res.status(404).json({ error: 'Employee not found.' })
    const managerName = target.managerId?.name ?? null
    // May be overwritten below if employmentType actually changes.
    let employmentTypeName = target.employmentType?.name ?? null

    const { dob, address, phone, education, aadharNumber, photoUrl, employmentType } = req.body || {}

    if (dob !== undefined) {
      if (dob) {
        const parsed = new Date(dob)
        if (Number.isNaN(parsed.getTime()) || parsed > new Date()) {
          return res.status(400).json({ error: 'Enter a valid date of birth.' })
        }
        target.dob = parsed
      } else {
        target.dob = undefined
      }
    }

    if (address !== undefined) {
      const trimmed = String(address).trim()
      if (trimmed.length > 300) {
        return res.status(400).json({ error: 'Address must be under 300 characters.' })
      }
      target.address = trimmed
    }

    if (phone !== undefined) {
      const trimmed = String(phone).trim()
      if (trimmed && !PHONE_RE.test(trimmed)) {
        return res.status(400).json({ error: 'Enter a valid phone number.' })
      }
      target.phone = trimmed
    }

    if (education !== undefined) {
      const trimmed = String(education).trim()
      if (trimmed.length > 500) {
        return res.status(400).json({ error: 'Education must be under 500 characters.' })
      }
      target.education = trimmed
    }

    if (aadharNumber !== undefined) {
      const digits = String(aadharNumber).replace(/\D/g, '')
      if (digits && !AADHAR_RE.test(digits)) {
        return res.status(400).json({ error: 'Aadhar number must be exactly 12 digits.' })
      }
      target.aadharNumber = digits
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
      target.photoUrl = trimmed
    }

    // Employment classification — HR data, not a personal detail, so unlike
    // every field above this is admin-only even when editing your own
    // profile. Only reseeds leaveQuotas/leaveBalances when the value
    // actually CHANGES (never on "field present but same as today"), so an
    // unrelated profile save can never silently reset someone's balance —
    // the frontend is expected to confirm this with the admin first, since
    // it discards any unused balance under the previous policy.
    if (employmentType !== undefined) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only an admin can change employment type.' })
      }
      const currentId = target.employmentType?._id ? target.employmentType._id.toString() : null
      const nextId = employmentType || null
      if (nextId && !mongoose.Types.ObjectId.isValid(nextId)) {
        return res.status(400).json({ error: 'Invalid employment type id.' })
      }
      if (nextId !== currentId) {
        let nextDoc = null
        if (nextId) {
          nextDoc = await EmploymentType.findById(nextId)
          if (!nextDoc) return res.status(400).json({ error: 'Selected employment type does not exist.' })
        }
        const quotas = nextDoc?.quotas || {}
        target.employmentType = nextId
        target.leaveQuotas = { ...quotas }
        target.leaveBalances = { ...quotas }
        target.markModified('leaveQuotas')
        target.markModified('leaveBalances')
        employmentTypeName = nextDoc?.name ?? null
      }
    }

    await target.save()
    res.json({ ...target.toProfileJSON(), managerName, employmentTypeName })
  } catch (err) {
    next(err)
  }
})

// Everything below is admin-only.
router.use(requireRole('admin'))

/** GET /api/employees — list everyone (admin view), with manager names. */
router.get('/', async (_req, res, next) => {
  try {
    const users = await User.find({})
      .populate('managerId', 'name')
      .populate('employmentType', 'name')
      .sort({ createdAt: 1 })
    res.json(
      users.map((u) => ({
        ...u.toSafeJSON(),
        managerName: u.managerId?.name ?? null,
        employmentTypeName: u.employmentType?.name ?? null,
      })),
    )
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/employees — add a new employee.
 * Body: { name, email, password, role, designation, department, joiningDate, managerId, employmentType }
 * The managerId is what wires this person into the org tree. employmentType
 * (optional) seeds leaveQuotas/leaveBalances from that policy's quotas —
 * left unassigned, the new hire starts with a zeroed leave balance until an
 * admin assigns one via their profile.
 */
router.post('/', async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      role = 'employee',
      designation = '',
      department = '',
      joiningDate,
      managerId = null,
      employmentType = null,
    } = req.body || {}

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required.' })
    }
    // Same policy as the bootstrap admin (utils/password.js) — an admin must
    // not be able to hand out weaker credentials than the system's own.
    const passwordError = passwordPolicyError(password)
    if (passwordError) {
      return res.status(400).json({ error: passwordError })
    }
    if (!['employee', 'manager', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' })
    }
    const normEmail = String(email).trim().toLowerCase()
    if (await User.findOne({ email: normEmail })) {
      return res.status(409).json({ error: 'An account with that email already exists.' })
    }
    if (managerId && !(await User.findById(managerId))) {
      return res.status(400).json({ error: 'Selected manager does not exist.' })
    }
    let employmentTypeDoc = null
    if (employmentType) {
      if (!mongoose.Types.ObjectId.isValid(employmentType)) {
        return res.status(400).json({ error: 'Invalid employment type.' })
      }
      employmentTypeDoc = await EmploymentType.findById(employmentType)
      if (!employmentTypeDoc) return res.status(400).json({ error: 'Selected employment type does not exist.' })
    }
    const quotas = employmentTypeDoc?.quotas || {}

    const user = new User({
      name: String(name).trim(),
      email: normEmail,
      role,
      designation: String(designation).trim(),
      department: String(department).trim(),
      joiningDate: joiningDate ? new Date(joiningDate) : undefined,
      managerId: managerId || null,
      employmentType: employmentTypeDoc?._id ?? null,
      leaveQuotas: { ...quotas },
      leaveBalances: { ...quotas },
    })
    await user.setPassword(String(password))
    await user.save()
    res.status(201).json({
      ...user.toSafeJSON(),
      managerName: null,
      employmentTypeName: employmentTypeDoc?.name ?? null,
    })
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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid employee id.' })
    }
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ error: 'You cannot change your own role.' })
    }

    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ error: 'Employee not found.' })
    if (user.role === role) return res.json(user.toSafeJSON())

    if (role === 'employee') {
      const reports = await User.countDocuments({ managerId: user._id })
      if (reports > 0) {
        return res.status(409).json({
          error: `${user.name} still manages ${reports} ${reports === 1 ? 'person' : 'people'} — reassign them to another manager first.`,
        })
      }
    }

    user.role = role
    await user.save()
    res.json(user.toSafeJSON())
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
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ error: 'Employee not found.' })

    if (managerId) {
      if (managerId === req.params.id) {
        return res.status(400).json({ error: 'An employee cannot manage themselves.' })
      }
      const manager = await User.findById(managerId)
      if (!manager) return res.status(400).json({ error: 'Selected manager does not exist.' })
      // Walk up the proposed manager's chain to make sure we don't form a cycle.
      let cursor = manager
      const seen = new Set([req.params.id])
      while (cursor) {
        if (seen.has(cursor._id.toString())) {
          return res.status(400).json({ error: 'That change would create a reporting loop.' })
        }
        seen.add(cursor._id.toString())
        cursor = cursor.managerId ? await User.findById(cursor.managerId) : null
      }
    }

    user.managerId = managerId || null
    await user.save()
    res.json(user.toSafeJSON())
  } catch (err) {
    next(err)
  }
})

export default router
