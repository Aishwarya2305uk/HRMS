import { Router } from 'express'
import { q } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { isValidId, teamJSON } from '../store.js'
import { descendantIds } from '../services/hierarchy.js'

const router = Router()
router.use(requireAuth)
// Only people who can have reports need project teams — same gate as the
// announcement-authoring routes.
router.use(requireRole('admin', 'manager'))

const NAME_MAX = 60

/** Attach `members` (id+name) resolved from member_ids. */
async function shapeTeam(row) {
  const { rows: members } = await q('select id, name from users where id = any($1)', [
    row.member_ids || [],
  ])
  const byId = new Map(members.map((m) => [m.id, m.name]))
  return {
    ...teamJSON(row),
    members: (row.member_ids || []).map((id) => ({ id, name: byId.get(id) ?? 'Unknown' })),
  }
}

/** Every proposed member must already be within the creator's own reporting subtree. */
async function validateMembers(managerId, memberIds) {
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return 'Pick at least one team member.'
  }
  const ids = [...new Set(memberIds.map(String))]
  if (ids.some((id) => !isValidId(id))) {
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
    const ids = await descendantIds(req.user.id)
    const { rows } = await q(
      'select id, name, designation, department from users where id = any($1)',
      [ids],
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

/** GET /api/teams/mine — the caller's own project teams, with member names. */
router.get('/mine', async (req, res, next) => {
  try {
    const { rows } = await q('select * from teams where manager_id = $1 order by name', [
      req.user.id,
    ])
    res.json(await Promise.all(rows.map(shapeTeam)))
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
    const memberError = await validateMembers(req.user.id, req.body?.memberIds)
    if (memberError) return res.status(400).json({ error: memberError })

    const { rows } = await q(
      'insert into teams (name, manager_id, member_ids) values ($1, $2, $3) returning *',
      [name, req.user.id, [...new Set(req.body.memberIds.map(String))]],
    )
    res.status(201).json(await shapeTeam(rows[0]))
  } catch (err) {
    next(err)
  }
})

/** Shared guard: only the team's own manager may view/edit/delete it here. */
async function loadOwnedTeam(req) {
  if (!isValidId(req.params.id)) {
    throw Object.assign(new Error('Invalid team id.'), { status: 400 })
  }
  const { rows } = await q('select * from teams where id = $1', [req.params.id])
  const team = rows[0]
  if (!team) throw Object.assign(new Error('Team not found.'), { status: 404 })
  if (team.manager_id !== req.user.id) {
    throw Object.assign(new Error('You can only manage teams you created.'), { status: 403 })
  }
  return team
}

/** PATCH /api/teams/:id — rename and/or replace membership. */
router.patch('/:id', async (req, res, next) => {
  try {
    const team = await loadOwnedTeam(req)

    let name = team.name
    let memberIds = team.member_ids
    if (req.body?.name !== undefined) {
      name = String(req.body.name).trim()
      if (!name || name.length > NAME_MAX) {
        return res.status(400).json({ error: `Give the team a name (max ${NAME_MAX} characters).` })
      }
    }
    if (req.body?.memberIds !== undefined) {
      const memberError = await validateMembers(req.user.id, req.body.memberIds)
      if (memberError) return res.status(400).json({ error: memberError })
      memberIds = [...new Set(req.body.memberIds.map(String))]
    }

    const { rows } = await q(
      'update teams set name = $1, member_ids = $2 where id = $3 returning *',
      [name, memberIds, req.params.id],
    )
    res.json(await shapeTeam(rows[0]))
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

/** DELETE /api/teams/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    const team = await loadOwnedTeam(req)
    await q('delete from teams where id = $1', [team.id])
    res.json({ id: req.params.id })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

export default router
