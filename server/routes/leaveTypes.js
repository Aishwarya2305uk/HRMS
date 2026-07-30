import { Router } from 'express'
import mongoose from 'mongoose'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { LeaveType } from '../models/LeaveType.js'

const router = Router()
router.use(requireAuth)
// Admin-management view (includes retired types, for reactivating). The
// active-only catalog everyone else uses for applying is GET /leaves/config.
router.use(requireRole('admin'))

const LABEL_MAX = 60

/** "Bereavement Leave" -> "bereavement-leave", deduped if the slug collides. */
async function generateKey(label) {
  const base =
    String(label)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'type'
  let key = base
  let n = 2
  while (await LeaveType.exists({ key })) {
    key = `${base}-${n}`
    n += 1
  }
  return key
}

/** GET /api/leave-types — every leave type, including retired ones. */
router.get('/', async (_req, res, next) => {
  try {
    const types = await LeaveType.find({}).sort({ createdAt: 1 })
    res.json(types.map((t) => t.toJSONSafe()))
  } catch (err) {
    next(err)
  }
})

/** POST /api/leave-types — create. Body: { label }. `key` is derived, never client-supplied. */
router.post('/', async (req, res, next) => {
  try {
    const label = String(req.body?.label || '').trim()
    if (!label || label.length > LABEL_MAX) {
      return res.status(400).json({ error: `Give it a name (max ${LABEL_MAX} characters).` })
    }
    const key = await generateKey(label)
    const type = await LeaveType.create({ key, label, active: true })
    res.status(201).json(type.toJSONSafe())
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/leave-types/:id — rename (label only — `key` is immutable once
 * created, since Leave documents reference it) and/or retire/reactivate.
 */
router.patch('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid leave type id.' })
    }
    const type = await LeaveType.findById(req.params.id)
    if (!type) return res.status(404).json({ error: 'Leave type not found.' })

    if (req.body?.label !== undefined) {
      const label = String(req.body.label).trim()
      if (!label || label.length > LABEL_MAX) {
        return res.status(400).json({ error: `Give it a name (max ${LABEL_MAX} characters).` })
      }
      type.label = label
    }
    if (req.body?.active !== undefined) {
      type.active = Boolean(req.body.active)
    }

    await type.save()
    res.json(type.toJSONSafe())
  } catch (err) {
    next(err)
  }
})

export default router
