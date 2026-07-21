import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { User } from '../models/User.js'
import { WorkSession, isRunning } from '../models/WorkSession.js'
import { dayKey } from '../utils/time.js'
import { defaultLeaveBalances } from '../config.js'

const router = Router()
router.use(requireAuth)

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
 * Available to ALL roles (per requirements): it's built purely from the
 * managerId self-reference. Roots are people with no manager (e.g. admins).
 * Each node also carries a coarse `activity` state for the presence dot.
 */
router.get('/org-tree', async (_req, res, next) => {
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

// Everything below is admin-only.
router.use(requireRole('admin'))

/** GET /api/employees — list everyone (admin view), with manager names. */
router.get('/', async (_req, res, next) => {
  try {
    const users = await User.find({}).populate('managerId', 'name').sort({ createdAt: 1 })
    res.json(
      users.map((u) => ({
        ...u.toSafeJSON(),
        managerName: u.managerId?.name ?? null,
      })),
    )
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/employees — add a new employee.
 * Body: { name, email, password, role, designation, department, joiningDate, managerId }
 * The managerId is what wires this person into the org tree.
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
    } = req.body || {}

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required.' })
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

    const user = new User({
      name: String(name).trim(),
      email: normEmail,
      role,
      designation: String(designation).trim(),
      department: String(department).trim(),
      joiningDate: joiningDate ? new Date(joiningDate) : undefined,
      managerId: managerId || null,
      leaveBalances: defaultLeaveBalances(),
    })
    await user.setPassword(String(password))
    await user.save()
    res.status(201).json({ ...user.toSafeJSON(), managerName: null })
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
