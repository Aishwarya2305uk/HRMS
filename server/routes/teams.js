import { Router } from 'express'
import mongoose from 'mongoose'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { Team } from '../models/Team.js'
import { User } from '../models/User.js'
import { descendantIds } from '../services/hierarchy.js'

const router = Router()
router.use(requireAuth)
// Only people who can have reports need project teams — same gate as the
// announcement-authoring routes.
router.use(requireRole('admin', 'manager'))

const NAME_MAX = 60

function shapeTeam(team) {
  return {
    ...team.toJSONSafe(),
    members: team.memberIds.map((m) => ({ id: m._id.toString(), name: m.name })),
  }
}

/** Every proposed member must already be within the creator's own reporting subtree. */
async function validateMembers(managerId, memberIds) {
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return 'Pick at least one team member.'
  }
  const ids = [...new Set(memberIds.map(String))]
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    return 'Invalid member id.'
  }
  const allowed = new Set(await descendantIds(managerId))
  if (ids.some((id) => !allowed.has(id))) {
    return 'You can only add people who report to you (directly or through their manager).'
  }
  return null
}

/**
 * GET /api/teams/candidates — everyone eligible to go into one of the
 * caller's own project teams (their full transitive reporting subtree).
 */
router.get('/candidates', async (req, res, next) => {
  try {
    const ids = await descendantIds(req.user._id)
    const users = await User.find({ _id: { $in: ids } }).select('name designation department')
    res.json(
      users.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        designation: u.designation,
        department: u.department,
      })),
    )
  } catch (err) {
    next(err)
  }
})

/** GET /api/teams/mine — the caller's own project teams, with member names. */
router.get('/mine', async (req, res, next) => {
  try {
    const teams = await Team.find({ managerId: req.user._id })
      .populate('memberIds', 'name')
      .sort({ name: 1 })
    res.json(teams.map(shapeTeam))
  } catch (err) {
    next(err)
  }
})

/** POST /api/teams — create a project team from among the caller's own reports. */
router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name || name.length > NAME_MAX) {
      return res.status(400).json({ error: `Give the team a name (max ${NAME_MAX} characters).` })
    }
    const memberError = await validateMembers(req.user._id, req.body?.memberIds)
    if (memberError) return res.status(400).json({ error: memberError })

    const team = await Team.create({
      name,
      managerId: req.user._id,
      memberIds: [...new Set(req.body.memberIds.map(String))],
    })
    await team.populate('memberIds', 'name')
    res.status(201).json(shapeTeam(team))
  } catch (err) {
    next(err)
  }
})

/** Shared guard: only the team's own manager may view/edit/delete it here. */
async function loadOwnedTeam(req) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw Object.assign(new Error('Invalid team id.'), { status: 400 })
  }
  const team = await Team.findById(req.params.id)
  if (!team) throw Object.assign(new Error('Team not found.'), { status: 404 })
  if (team.managerId.toString() !== req.user._id.toString()) {
    throw Object.assign(new Error('You can only manage teams you created.'), { status: 403 })
  }
  return team
}

/** PATCH /api/teams/:id — rename and/or replace membership. */
router.patch('/:id', async (req, res, next) => {
  try {
    const team = await loadOwnedTeam(req)

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim()
      if (!name || name.length > NAME_MAX) {
        return res.status(400).json({ error: `Give the team a name (max ${NAME_MAX} characters).` })
      }
      team.name = name
    }
    if (req.body?.memberIds !== undefined) {
      const memberError = await validateMembers(req.user._id, req.body.memberIds)
      if (memberError) return res.status(400).json({ error: memberError })
      team.memberIds = [...new Set(req.body.memberIds.map(String))]
    }

    await team.save()
    await team.populate('memberIds', 'name')
    res.json(shapeTeam(team))
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

/** DELETE /api/teams/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    const team = await loadOwnedTeam(req)
    await team.deleteOne()
    res.json({ id: req.params.id })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

export default router
