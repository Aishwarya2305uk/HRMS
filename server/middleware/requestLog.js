import { q } from '../db.js'

/**
 * Records every /api request into request_logs — the data behind the admin
 * System Logs page. One row per call: who, method + path, outcome, timing,
 * and the reason whenever the call failed.
 *
 * Privacy rules (also stated on that page): request bodies (passwords, form
 * values, documents), query strings (invite/reset tokens travel there) and
 * headers are NEVER stored — only the path itself and the response outcome.
 *
 * Append-only by design: there is no update or delete API (an audit trail
 * must not be editable) — rows only leave via the 30-day retention sweep.
 */

// Mirror the varchar caps in schema.js so an oversized value truncates
// instead of failing the insert and losing the row.
const trunc = (v, n) => (v == null ? null : String(v).slice(0, n))

/** Coarse machine-readable code for a failure, derived from its status. */
function codeFor(status) {
  if (status >= 500) return 'INTERNAL'
  const named = {
    400: 'VALIDATION',
    401: 'AUTH',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    413: 'TOO_LARGE',
    429: 'RATE_LIMIT',
  }
  return named[status] ?? `HTTP_${status}`
}

export function requestLog(req, res, next) {
  if (req.method === 'OPTIONS') return next() // CORS preflight, not API activity

  const startedAt = process.hrtime.bigint()

  // Remember the one-line reason routes send as res.json({ error: '…' }) so a
  // failed call's row can say why. Only that string — never the whole body.
  let errorLine = null
  const json = res.json.bind(res)
  res.json = (body) => {
    if (body && typeof body.error === 'string') errorLine = body.error
    return json(body)
  }

  res.on('finish', () => {
    const path = (req.originalUrl || req.url || '').split('?')[0]
    // Watching the logs page shouldn't itself fill the table — only failed
    // calls to it earn a row.
    if (path.startsWith('/api/system-logs') && res.statusCode < 400) return

    const status = res.statusCode
    const failed = status >= 400
    // Crashes: the error handler stashes the real message on res.locals (the
    // HTTP response only ever carries a generic line — see app.js). Deliberate
    // 4xx reasons come from the captured res.json error line.
    const reason = failed ? (res.locals.logDetail ?? errorLine ?? `HTTP ${status}`) : null

    q(
      `insert into request_logs
         (method, path, status, duration_ms, user_email, user_role, ip, error_code, error_message)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        trunc(req.method, 10),
        trunc(path, 300),
        status,
        Math.min(Number((process.hrtime.bigint() - startedAt) / 1_000_000n), 2 ** 31 - 1),
        trunc(req.user?.email, 254),
        trunc(req.user?.role, 20),
        trunc(req.ip, 64),
        failed ? trunc(codeFor(status), 30) : null,
        trunc(reason, 500),
      ],
      // Fire-and-forget: telemetry must never break or slow the request it
      // describes, so a failed insert is deliberately swallowed.
    ).catch(() => {})

    // 30-day retention with no cron service: ~2% of writes also sweep expired
    // rows (the admin list endpoint sweeps deterministically as well).
    if (Math.random() < 0.02) {
      q(`delete from request_logs where ts < now() - interval '30 days'`).catch(() => {})
    }
  })

  next()
}
