import { Router } from 'express'
import { q } from '../db.js'
import { cachedLeaveTypes, invalidate } from '../cache.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { isValidId, leaveTypeJSON } from '../store.js'

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
  while ((await q('select 1 from leave_types where key = $1', [key])).rows.length) {
    key = `${base}-${n}`
    n += 1
  }
  return key
}

/** GET /api/leave-types — every leave type, including retired ones. */
router.get('/', async (_req, res, next) => {
  try {
    const rows = await cachedLeaveTypes()
    res.json(rows.map(leaveTypeJSON))
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
    const { rows } = await q(
      'insert into leave_types (key, label, active) values ($1, $2, true) returning *',
      [key, label],
    )
    invalidate('leave_types')
    res.status(201).json(leaveTypeJSON(rows[0]))
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/leave-types/:id — rename (label only — `key` is immutable once
 * created, since leaves reference it) and/or retire/reactivate.
 */
router.patch('/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid leave type id.' })
    }
    const { rows: found } = await q('select * from leave_types where id = $1', [req.params.id])
    const type = found[0]
    if (!type) return res.status(404).json({ error: 'Leave type not found.' })

    let label = type.label
    let active = type.active
    if (req.body?.label !== undefined) {
      label = String(req.body.label).trim()
      if (!label || label.length > LABEL_MAX) {
        return res.status(400).json({ error: `Give it a name (max ${LABEL_MAX} characters).` })
      }
    }
    if (req.body?.active !== undefined) {
      active = Boolean(req.body.active)
    }

    const { rows } = await q(
      'update leave_types set label = $1, active = $2 where id = $3 returning *',
      [label, active, req.params.id],
    )
    invalidate('leave_types')
    res.json(leaveTypeJSON(rows[0]))
  } catch (err) {
    next(err)
  }
})

export default router
