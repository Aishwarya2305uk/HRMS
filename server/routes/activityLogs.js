import { Router } from 'express'
import { q } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_RETENTION_DAYS,
  ACTIVITY_TYPES,
  sweepActivityLogs,
} from '../services/activityLog.js'

const router = Router()
// Read-only, admins only — same posture as system-logs. There is deliberately
// no write/update/delete endpoint: rows are produced by the routes that
// perform the actions (services/activityLog.js) and expire on their own.
router.use(requireAuth, requireRole('admin'))

const STATUSES = new Set(['success', 'failed'])
const CATEGORIES = new Set(ACTIVITY_CATEGORIES)

/** DB row -> API shape. `label`/`icon` are resolved from the registry rather
 *  than stored, so relabelling an action updates history's presentation
 *  without rewriting the recorded facts. */
function activityJSON(r) {
  const type = ACTIVITY_TYPES[r.action]
  return {
    id: r.id,
    ts: r.ts,
    action: r.action,
    label: type?.label ?? r.action,
    icon: type?.icon ?? 'activity',
    category: r.category,
    description: r.description,
    actorId: r.actor_id,
    actorName: r.actor_name,
    actorEmail: r.actor_email,
    actorRole: r.actor_role,
    targetType: r.target_type || '',
    targetName: r.target_name || '',
    status: r.status,
    ip: r.ip,
  }
}

/**
 * GET /api/activity-logs — newest first, filtered. All params optional;
 * unknown values are ignored rather than erroring, matching system-logs.
 *   search   — matches the human description, actor name/email, or target name
 *   actor    — actor uuid
 *   category — one of ACTIVITY_CATEGORIES
 *   action   — a specific ACTIVITY_TYPES key
 *   status   — success | failed
 *   from,to  — 'YYYY-MM-DD' inclusive date range
 *   days     — 1 | 7 | 30 | 90 | 365 (ignored when `from`/`to` is given)
 *   limit    — <= 500, default 200
 */
router.get('/', async (req, res, next) => {
  try {
    await sweepActivityLogs()

    const where = []
    const params = []

    const search = String(req.query.search ?? '').trim().slice(0, 100)
    if (search) {
      // Escape LIKE wildcards so searching "100%" means that literal text.
      params.push(`%${search.replace(/([\\%_])/g, '\\$1')}%`)
      const p = `$${params.length}`
      // Search reads the way the page reads: the sentence first, then who did
      // it and what it was done to.
      where.push(
        `(description ilike ${p} or actor_name ilike ${p} or actor_email ilike ${p} or target_name ilike ${p})`,
      )
    }

    const actor = String(req.query.actor ?? '')
    // Guard the uuid shape — a malformed cast would 500 the whole page.
    if (/^[0-9a-f-]{36}$/i.test(actor)) {
      params.push(actor)
      where.push(`actor_id = $${params.length}`)
    }

    const category = String(req.query.category ?? '')
    if (CATEGORIES.has(category)) {
      params.push(category)
      where.push(`category = $${params.length}`)
    }

    const action = String(req.query.action ?? '')
    if (ACTIVITY_TYPES[action]) {
      params.push(action)
      where.push(`action = $${params.length}`)
    }

    const status = String(req.query.status ?? '')
    if (STATUSES.has(status)) {
      params.push(status)
      where.push(`status = $${params.length}`)
    }

    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    const from = String(req.query.from ?? '')
    const to = String(req.query.to ?? '')
    if (dateRe.test(from)) {
      params.push(`${from}T00:00:00.000Z`)
      where.push(`ts >= $${params.length}`)
    }
    if (dateRe.test(to)) {
      // Inclusive of the whole end day, not midnight at its start.
      params.push(`${to}T23:59:59.999Z`)
      where.push(`ts <= $${params.length}`)
    }
    // A explicit range wins over the rolling window, so the two can't fight.
    if (!dateRe.test(from) && !dateRe.test(to)) {
      const days = Number(req.query.days)
      if ([1, 7, 30, 90, 365].includes(days)) {
        params.push(days)
        where.push(`ts >= now() - make_interval(days => $${params.length})`)
      }
    }

    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit) || 200)))
    params.push(limit)

    const { rows } = await q(
      `select id, ts, actor_id, actor_name, actor_email, actor_role, action,
              category, description, target_type, target_name, status, ip
         from activity_logs
        ${where.length ? `where ${where.join(' and ')}` : ''}
        order by ts desc
        limit $${params.length}`,
      params,
    )
    res.json(rows.map(activityJSON))
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/activity-logs/filters — everything the filter bar needs to render
 * itself: the category list from the registry, and the distinct people who
 * actually appear in the trail (so the User dropdown offers real names rather
 * than the whole roster, including people since deleted).
 */
router.get('/filters', async (_req, res, next) => {
  try {
    const { rows } = await q(
      `select distinct actor_id as id, actor_name as name
         from activity_logs
        where actor_id is not null and actor_name <> ''
        order by actor_name`,
    )
    res.json({
      categories: ACTIVITY_CATEGORIES,
      actors: rows,
      retentionDays: ACTIVITY_RETENTION_DAYS,
    })
  } catch (err) {
    next(err)
  }
})

export default router
