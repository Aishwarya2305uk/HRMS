import { Router } from 'express'
import { q } from '../db.js'
import { cachedEmploymentTypes, invalidate } from '../cache.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { isValidId, employmentTypeJSON } from '../store.js'
import { recordActivity } from '../services/activityLog.js'

const router = Router()
router.use(requireAuth)
// Admin-only in full — regular employees never need the raw catalog, only
// their own already-resolved leaveBalances/leaveQuotas via /auth/me.
router.use(requireRole('admin'))

const NAME_MAX = 60

/** Keeps quotas to non-negative numbers; unrelated/garbage keys are dropped. */
function sanitizeQuotas(input) {
  const out = {}
  if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input)) {
      const days = Number(value)
      if (Number.isFinite(days) && days >= 0) out[key] = days
    }
  }
  return out
}

/** GET /api/employment-types — every employment type with its quota table. */
router.get('/', async (_req, res, next) => {
  try {
    const rows = await cachedEmploymentTypes()
    res.json(rows.map(employmentTypeJSON))
  } catch (err) {
    next(err)
  }
})

/** POST /api/employment-types — create. Body: { name, quotas? } */
router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name || name.length > NAME_MAX) {
      return res.status(400).json({ error: `Give it a name (max ${NAME_MAX} characters).` })
    }
    const { rows } = await q(
      'insert into employment_types (name, quotas) values ($1, $2) returning *',
      [name, JSON.stringify(sanitizeQuotas(req.body?.quotas))],
    )
    invalidate('employment_types')
    recordActivity(req, 'employment_type.created', {
      targetType: 'employment_type',
      targetId: rows[0].id,
      targetName: name,
      description: `${req.user.name} created the employment type "${name}".`,
    })
    res.status(201).json(employmentTypeJSON(rows[0]))
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/employment-types/:id — rename and/or replace the quota table.
 * Deliberately NOT retroactive: this only changes the policy row itself.
 * People already assigned this type keep their frozen users.leave_quotas
 * snapshot from whenever they were assigned — only future assignments see
 * the new numbers.
 */
router.patch('/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid employment type id.' })
    }
    const { rows: found } = await q('select * from employment_types where id = $1', [req.params.id])
    const type = found[0]
    if (!type) return res.status(404).json({ error: 'Employment type not found.' })

    let name = type.name
    let quotas = type.quotas
    if (req.body?.name !== undefined) {
      name = String(req.body.name).trim()
      if (!name || name.length > NAME_MAX) {
        return res.status(400).json({ error: `Give it a name (max ${NAME_MAX} characters).` })
      }
    }
    if (req.body?.quotas !== undefined) {
      quotas = sanitizeQuotas(req.body.quotas)
    }

    const { rows } = await q(
      'update employment_types set name = $1, quotas = $2 where id = $3 returning *',
      [name, JSON.stringify(quotas), req.params.id],
    )
    invalidate('employment_types')
    recordActivity(req, 'employment_type.updated', {
      targetType: 'employment_type',
      targetId: rows[0].id,
      targetName: name,
      description:
        `${req.user.name} updated the employment type "${name}"` +
        `${type.name !== name ? ` (renamed from "${type.name}")` : ''}.`,
    })
    res.json(employmentTypeJSON(rows[0]))
  } catch (err) {
    next(err)
  }
})

/** DELETE /api/employment-types/:id — only when nobody is currently assigned it. */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid employment type id.' })
    }
    const { rows: inUse } = await q('select 1 from users where employment_type_id = $1 limit 1', [
      req.params.id,
    ])
    if (inUse.length) {
      return res
        .status(409)
        .json({ error: 'People are currently assigned to this employment type — reassign them first.' })
    }
    const { rowCount } = await q('delete from employment_types where id = $1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Employment type not found.' })
    invalidate('employment_types')
    recordActivity(req, 'employment_type.deleted', {
      targetType: 'employment_type',
      targetId: req.params.id,
      description: `${req.user.name} deleted an employment type.`,
    })
    res.json({ id: req.params.id })
  } catch (err) {
    next(err)
  }
})

export default router
