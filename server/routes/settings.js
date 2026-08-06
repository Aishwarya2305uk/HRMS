import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { AppSettings } from '../models/AppSettings.js'

const router = Router()
router.use(requireAuth)

const URL_MAX = 2048
const LINK_FIELDS = ['feedbackFormUrl', 'hrRequestFormUrl']

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
    const settings = await AppSettings.getSingleton()
    res.json(settings.toJSONSafe())
  } catch (err) {
    next(err)
  }
})

/** PATCH /api/settings — admin only. Body: any of { feedbackFormUrl, hrRequestFormUrl }. */
router.patch('/', requireRole('admin'), async (req, res, next) => {
  try {
    const updates = {}
    for (const field of LINK_FIELDS) {
      if (req.body?.[field] === undefined) continue
      const url = cleanUrl(req.body[field])
      if (url === null) {
        return res
          .status(400)
          .json({ error: 'Links must be full http:// or https:// URLs (or empty to clear).' })
      }
      updates[field] = url
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' })
    }

    const settings = await AppSettings.getSingleton()
    Object.assign(settings, updates)
    await settings.save()
    res.json(settings.toJSONSafe())
  } catch (err) {
    next(err)
  }
})

export default router
