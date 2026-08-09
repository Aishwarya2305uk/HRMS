import { Router } from 'express'
import { q } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()
// Read-only audit trail, admins only. There is deliberately no write, update
// or delete endpoint — the rows are produced by middleware/requestLog.js and
// expire on their own after 30 days.
router.use(requireAuth, requireRole('admin'))

/** Whitelisted SQL fragments — the client only ever picks a key. */
const LEVEL_WHERE = {
  ok: 'status < 400',
  client: 'status between 400 and 499',
  server: 'status >= 500',
}
const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
const ROLES = new Set(['employee', 'manager', 'admin'])

/** DB row -> API shape. `ip` is stored for audits but not served to the UI. */
function logJSON(r) {
  return {
    id: r.id,
    ts: r.ts,
    method: r.method,
    path: r.path,
    status: r.status,
    durationMs: r.duration_ms,
    userEmail: r.user_email,
    userRole: r.user_role,
    errorCode: r.error_code,
    errorMessage: r.error_message,
  }
}

/**
 * GET /api/system-logs — newest first, filtered. Query params (all optional,
 * unknown values ignored): search (email substring), role (or 'anonymous'),
 * level (ok|client|server), method, days (1|7|30), limit (<=500, default 200).
 */
router.get('/', async (req, res, next) => {
  try {
    // Deterministic retention sweep on read keeps the "30 days kept" promise
    // honest even if the probabilistic write-time sweep hasn't fired lately.
    await q(`delete from request_logs where ts < now() - interval '30 days'`)

    const where = []
    const params = []

    const search = String(req.query.search ?? '').trim().slice(0, 100)
    if (search) {
      // Escape LIKE wildcards so searching "100%" means that literal text.
      params.push(`%${search.replace(/([\\%_])/g, '\\$1')}%`)
      where.push(`user_email ilike $${params.length}`)
    }

    const role = String(req.query.role ?? '')
    if (role === 'anonymous') {
      where.push('user_email is null')
    } else if (ROLES.has(role)) {
      params.push(role)
      where.push(`user_role = $${params.length}`)
    }

    const level = String(req.query.level ?? '')
    if (LEVEL_WHERE[level]) where.push(LEVEL_WHERE[level])

    const method = String(req.query.method ?? '').toUpperCase()
    if (METHODS.has(method)) {
      params.push(method)
      where.push(`method = $${params.length}`)
    }

    const days = Number(req.query.days)
    if ([1, 7, 30].includes(days)) {
      params.push(days)
      where.push(`ts >= now() - make_interval(days => $${params.length})`)
    }

    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit) || 200)))
    params.push(limit)

    const { rows } = await q(
      `select id, ts, method, path, status, duration_ms,
              user_email, user_role, error_code, error_message
         from request_logs
        ${where.length ? `where ${where.join(' and ')}` : ''}
        order by ts desc
        limit $${params.length}`,
      params,
    )
    res.json(rows.map(logJSON))
  } catch (err) {
    next(err)
  }
})

export default router
