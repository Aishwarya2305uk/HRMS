import { Router } from 'express'
import { q } from '../db.js'
import { cachedLeaveTypes, invalidate } from '../cache.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { isValidId, leaveTypeJSON } from '../store.js'
import { recordActivity } from '../services/activityLog.js'

const router = Router()
router.use(requireAuth)
// Admin-management view (includes retired types, for reactivating). The
// active-only catalog everyone else uses for applying is GET /leaves/config.
router.use(requireRole('admin'))

const LABEL_MAX = 60
// Policy shape whitelists: quotas mean "<x> <unit> per <period>".
const UNITS = ['days', 'hours']
const PERIODS = ['day', 'month', 'year']

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

/** POST /api/leave-types — create. Body: { label, unit?, period? }.
 *  `key` is derived, never client-supplied. */
router.post('/', async (req, res, next) => {
  try {
    const label = String(req.body?.label || '').trim()
    if (!label || label.length > LABEL_MAX) {
      return res.status(400).json({ error: `Give it a name (max ${LABEL_MAX} characters).` })
    }
    const unit = req.body?.unit ?? 'days'
    const period = req.body?.period ?? 'year'
    if (!UNITS.includes(unit) || !PERIODS.includes(period)) {
      return res.status(400).json({ error: 'Policy must be in days or hours, per day, month or year.' })
    }
    const key = await generateKey(label)
    const { rows } = await q(
      'insert into leave_types (key, label, active, unit, period) values ($1, $2, true, $3, $4) returning *',
      [key, label, unit, period],
    )
    invalidate('leave_types')
    recordActivity(req, 'leave_type.created', {
      targetType: 'leave_type',
      targetId: rows[0].id,
      targetName: label,
      description: `${req.user.name} created the leave type "${label}" (${unit} per ${period}).`,
    })
    res.status(201).json(leaveTypeJSON(rows[0]))
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/leave-types/:id — rename (label only — `key` is immutable once
 * created, since leaves reference it), retire/reactivate, and/or change the
 * policy shape (unit/period). Changing the period switches how balances are
 * tracked (stored yearly counter vs computed per-period) from then on.
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
    let unit = type.unit ?? 'days'
    let period = type.period ?? 'year'
    if (req.body?.label !== undefined) {
      label = String(req.body.label).trim()
      if (!label || label.length > LABEL_MAX) {
        return res.status(400).json({ error: `Give it a name (max ${LABEL_MAX} characters).` })
      }
    }
    if (req.body?.active !== undefined) {
      active = Boolean(req.body.active)
    }
    if (req.body?.unit !== undefined) unit = req.body.unit
    if (req.body?.period !== undefined) period = req.body.period
    if (!UNITS.includes(unit) || !PERIODS.includes(period)) {
      return res.status(400).json({ error: 'Policy must be in days or hours, per day, month or year.' })
    }

    const { rows } = await q(
      'update leave_types set label = $1, active = $2, unit = $3, period = $4 where id = $5 returning *',
      [label, active, unit, period, req.params.id],
    )
    invalidate('leave_types')
    // Retiring/reactivating is the change an HR admin most needs to see in the
    // trail — it silently changes what everyone can apply for.
    const retireNote =
      type.active === active ? '' : active ? ' and reactivated it' : ' and retired it'
    recordActivity(req, 'leave_type.updated', {
      targetType: 'leave_type',
      targetId: req.params.id,
      targetName: label,
      description:
        `${req.user.name} updated the leave type "${label}"` +
        `${type.label !== label ? ` (renamed from "${type.label}")` : ''}` +
        `${retireNote} — now ${unit} per ${period}.`,
    })
    res.json(leaveTypeJSON(rows[0]))
  } catch (err) {
    next(err)
  }
})

export default router
