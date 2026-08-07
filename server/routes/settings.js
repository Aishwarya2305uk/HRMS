import { Router } from 'express'
import { q } from '../db.js'
import { cached, invalidate } from '../cache.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { settingsJSON } from '../store.js'

const router = Router()
router.use(requireAuth)

const URL_MAX = 2048
// API field → column, one entry per admin-editable link.
const LINK_FIELDS = {
  feedbackFormUrl: 'feedback_form_url',
  hrRequestFormUrl: 'hr_request_form_url',
}

/** Upsert-on-read: the first access creates the (empty) singleton row atomically. */
async function getSingleton() {
  const { rows } = await q(
    `insert into app_settings (id) values (1)
     on conflict (id) do update set id = 1
     returning *`,
  )
  return rows[0]
}

/**
 * '' clears a link; anything else must parse as a plain http(s) URL — these
 * values end up in window.open on every user's client, so javascript:/data:
 * and friends must never be storable. Returns the trimmed value, or null
 * when invalid.
 */
function cleanUrl(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (raw.length > URL_MAX) return null
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return raw
}

/** GET /api/settings — the org-wide form links every signed-in user's sidebar needs. */
router.get('/', async (_req, res, next) => {
  try {
    res.json(settingsJSON(await cached('app_settings', getSingleton)))
  } catch (err) {
    next(err)
  }
})

/** PATCH /api/settings — admin only. Body: any of { feedbackFormUrl, hrRequestFormUrl }. */
router.patch('/', requireRole('admin'), async (req, res, next) => {
  try {
    const sets = []
    const params = []
    for (const [field, column] of Object.entries(LINK_FIELDS)) {
      if (req.body?.[field] === undefined) continue
      const url = cleanUrl(req.body[field])
      if (url === null) {
        return res
          .status(400)
          .json({ error: 'Links must be full http:// or https:// URLs (or empty to clear).' })
      }
      params.push(url)
      sets.push(`${column} = $${params.length}`)
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' })
    }

    await getSingleton()
    const { rows } = await q(`update app_settings set ${sets.join(', ')} where id = 1 returning *`, params)
    invalidate('app_settings')
    res.json(settingsJSON(rows[0]))
  } catch (err) {
    next(err)
  }
})

export default router
