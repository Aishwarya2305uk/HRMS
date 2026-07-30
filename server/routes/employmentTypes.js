import { Router } from 'express'
import mongoose from 'mongoose'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { EmploymentType } from '../models/EmploymentType.js'
import { User } from '../models/User.js'

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
    const types = await EmploymentType.find({}).sort({ createdAt: 1 })
    res.json(types.map((t) => t.toJSONSafe()))
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
    const type = await EmploymentType.create({ name, quotas: sanitizeQuotas(req.body?.quotas) })
    res.status(201).json(type.toJSONSafe())
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/employment-types/:id — rename and/or replace the quota table.
 * Deliberately NOT retroactive: this only changes the policy document
 * itself. People already assigned this type keep their frozen
 * User.leaveQuotas snapshot from whenever they were assigned (see
 * models/User.js) — only future assignments see the new numbers.
 */
router.patch('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid employment type id.' })
    }
    const type = await EmploymentType.findById(req.params.id)
    if (!type) return res.status(404).json({ error: 'Employment type not found.' })

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim()
      if (!name || name.length > NAME_MAX) {
        return res.status(400).json({ error: `Give it a name (max ${NAME_MAX} characters).` })
      }
      type.name = name
    }
    if (req.body?.quotas !== undefined) {
      type.quotas = sanitizeQuotas(req.body.quotas)
      type.markModified('quotas')
    }

    await type.save()
    res.json(type.toJSONSafe())
  } catch (err) {
    next(err)
  }
})

/** DELETE /api/employment-types/:id — only when nobody is currently assigned it. */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid employment type id.' })
    }
    const inUse = await User.exists({ employmentType: req.params.id })
    if (inUse) {
      return res
        .status(409)
        .json({ error: 'People are currently assigned to this employment type — reassign them first.' })
    }
    const type = await EmploymentType.findById(req.params.id)
    if (!type) return res.status(404).json({ error: 'Employment type not found.' })
    await type.deleteOne()
    res.json({ id: req.params.id })
  } catch (err) {
    next(err)
  }
})

export default router
