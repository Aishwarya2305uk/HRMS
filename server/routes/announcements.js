import { Router } from 'express'
import mongoose from 'mongoose'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { Announcement } from '../models/Announcement.js'
import { User } from '../models/User.js'
import { ancestorChain } from '../services/hierarchy.js'

const router = Router()
router.use(requireAuth)

const TITLE_MAX = 140
const BODY_MAX = 2000
const LIST_LIMIT = 100 // small internal user base — plenty of headroom, keeps the query bounded
const ROLES = ['employee', 'manager', 'admin']

/** Whether announcement `a` reaches a viewer with `viewerRole` whose upward chain is `chain`. */
function matchesAudience(a, viewerRole, chain) {
  if (a.audienceScope === 'all') return true
  if (a.audienceScope === 'role') return a.audienceRole === viewerRole
  const rootId = a.audienceRootId?._id
    ? a.audienceRootId._id.toString()
    : a.audienceRootId?.toString()
  return rootId ? chain.has(rootId) : false
}

/**
 * GET /api/announcements — everything targeted at the current viewer
 * (urgent + regular), newest first, each carrying a per-viewer `read` flag.
 */
router.get('/', async (req, res, next) => {
  try {
    const [all, chain] = await Promise.all([
      Announcement.find({})
        .populate('authorId', 'name')
        .populate('audienceRootId', 'name')
        .sort({ createdAt: -1 })
        .limit(LIST_LIMIT),
      ancestorChain(req.user._id),
    ])
    const mine = all.filter((a) => matchesAudience(a, req.user.role, chain))
    res.json(
      mine.map((a) => ({
        ...a.toJSONSafe(),
        read: a.readBy.some((id) => id.toString() === req.user._id.toString()),
      })),
    )
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/announcements/read-all — mark every currently-visible item read.
 * Fired once by the drawer when it opens.
 */
router.post('/read-all', async (req, res, next) => {
  try {
    const [unread, chain] = await Promise.all([
      Announcement.find({ readBy: { $ne: req.user._id } }),
      ancestorChain(req.user._id),
    ])
    const ids = unread.filter((a) => matchesAudience(a, req.user.role, chain)).map((a) => a._id)
    if (ids.length) {
      await Announcement.updateMany({ _id: { $in: ids } }, { $addToSet: { readBy: req.user._id } })
    }
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/** Everything below is for authoring — admins and managers only. */
router.use(requireRole('admin', 'manager'))

/**
 * GET /api/announcements/audience-options — who the current user is allowed
 * to target, for the composer's "Send to" picker. Team sizes are the full
 * TRANSITIVE subtree (a manager's whole downstream org), not just direct
 * reports, since that's exactly what a 'team' broadcast reaches.
 */
router.get('/audience-options', async (req, res, next) => {
  try {
    const users = await User.find({}).select('name managerId')
    const byId = new Map(users.map((u) => [u._id.toString(), u]))

    // For every user, walk their chain to the top; each ancestor's subtree
    // grows by one. Cheap in-memory pass since the whole roster is already
    // loaded (same scale assumption as the existing org-tree endpoint).
    const subtreeSize = new Map()
    for (const u of users) {
      const seen = new Set([u._id.toString()])
      let cursor = u.managerId ? u.managerId.toString() : null
      while (cursor && !seen.has(cursor)) {
        subtreeSize.set(cursor, (subtreeSize.get(cursor) || 0) + 1)
        seen.add(cursor)
        const next = byId.get(cursor)?.managerId
        cursor = next ? next.toString() : null
      }
    }

    const viewerId = req.user._id.toString()
    const managerIds =
      req.user.role === 'admin'
        ? [...subtreeSize.keys()]
        : subtreeSize.has(viewerId)
          ? [viewerId]
          : []

    const teams = managerIds
      .map((id) => ({
        id,
        label: id === viewerId ? 'My team' : `${byId.get(id)?.name ?? 'Unknown'}'s team`,
        size: subtreeSize.get(id) ?? 0,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))

    res.json({
      canTargetAll: req.user.role === 'admin',
      canTargetRole: req.user.role === 'admin',
      teams,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/announcements — compose.
 * Body: { title, body, type, audienceScope, audienceRole?, audienceRootId? }
 */
router.post('/', async (req, res, next) => {
  try {
    const { title, body, type = 'announcement', audienceScope, audienceRole, audienceRootId } =
      req.body || {}

    const cleanTitle = String(title || '').trim()
    const cleanBody = String(body || '').trim()
    if (!cleanTitle || cleanTitle.length > TITLE_MAX) {
      return res.status(400).json({ error: `Title is required (max ${TITLE_MAX} characters).` })
    }
    if (!cleanBody || cleanBody.length > BODY_MAX) {
      return res.status(400).json({ error: `Message is required (max ${BODY_MAX} characters).` })
    }
    if (!['announcement', 'urgent'].includes(type)) {
      return res.status(400).json({ error: 'Invalid message type.' })
    }
    if (!['all', 'role', 'team'].includes(audienceScope)) {
      return res.status(400).json({ error: 'Choose who this is for.' })
    }

    let finalAudienceRole = null
    let finalRootId = null

    if (audienceScope === 'all' || audienceScope === 'role') {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can broadcast company-wide or by role.' })
      }
      if (audienceScope === 'role') {
        if (!ROLES.includes(audienceRole)) {
          return res.status(400).json({ error: 'Choose a valid role to target.' })
        }
        finalAudienceRole = audienceRole
      }
    } else {
      // audienceScope === 'team'
      if (!mongoose.Types.ObjectId.isValid(audienceRootId)) {
        return res.status(400).json({ error: 'Choose a valid team to target.' })
      }
      if (req.user.role === 'admin') {
        const exists = await User.exists({ _id: audienceRootId })
        if (!exists) return res.status(400).json({ error: 'Selected team no longer exists.' })
      } else {
        const chain = await ancestorChain(audienceRootId)
        if (!chain.has(req.user._id.toString())) {
          return res.status(403).json({ error: 'You can only broadcast to your own team.' })
        }
      }
      finalRootId = audienceRootId
    }

    const announcement = await Announcement.create({
      title: cleanTitle,
      body: cleanBody,
      type,
      authorId: req.user._id,
      audienceScope,
      audienceRole: finalAudienceRole,
      audienceRootId: finalRootId,
      readBy: [req.user._id], // the author has implicitly seen their own post
    })
    console.log(`[announcements] ${req.user.email} posted "${cleanTitle}" (${audienceScope})`)
    res.status(201).json({ ...announcement.toJSONSafe(), authorName: req.user.name, read: true })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/announcements/:id — retract. Admins can remove any; managers
 * only ones they authored themselves.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid announcement id.' })
    }
    const item = await Announcement.findById(req.params.id)
    if (!item) return res.status(404).json({ error: 'Announcement not found.' })
    if (req.user.role !== 'admin' && item.authorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'You can only remove announcements you posted.' })
    }
    await item.deleteOne()
    console.log(`[announcements] ${req.user.email} removed announcement ${req.params.id}`)
    res.json({ id: req.params.id })
  } catch (err) {
    next(err)
  }
})

export default router
