import { Router } from 'express'
import mongoose from 'mongoose'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { Announcement } from '../models/Announcement.js'
import { User } from '../models/User.js'
import { Team } from '../models/Team.js'
import { ancestorChain } from '../services/hierarchy.js'

const router = Router()
router.use(requireAuth)

const TITLE_MAX = 140
const BODY_MAX = 2000
const LIST_LIMIT = 100 // small internal user base — plenty of headroom, keeps the query bounded
const ROLES = ['employee', 'manager', 'admin']

/** Whether announcement `a` reaches `viewer` (the full req.user), whose upward chain is `chain`. */
function matchesAudience(a, viewer, chain) {
  if (a.audienceScope === 'all') return true
  if (a.audienceScope === 'role') return a.audienceRole === viewer.role
  if (a.audienceScope === 'group') {
    const memberIds = a.audienceGroupId?.memberIds ?? []
    return memberIds.some((id) => id.toString() === viewer._id.toString())
  }
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
        .populate('audienceGroupId', 'name memberIds')
        .sort({ createdAt: -1 })
        .limit(LIST_LIMIT),
      ancestorChain(req.user._id),
    ])
    const mine = all.filter((a) => matchesAudience(a, req.user, chain))
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
      Announcement.find({ readBy: { $ne: req.user._id } }).populate('audienceGroupId', 'memberIds'),
      ancestorChain(req.user._id),
    ])
    const ids = unread.filter((a) => matchesAudience(a, req.user, chain)).map((a) => a._id)
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

    // The caller's own named project teams — a finer-grained alternative to
    // broadcasting to the whole subtree above.
    const ownTeams = await Team.find({ managerId: req.user._id }).select('name memberIds')
    const groups = ownTeams
      .map((t) => ({ id: t._id.toString(), name: t.name, size: t.memberIds.length }))
      .sort((a, b) => a.name.localeCompare(b.name))

    res.json({
      canTargetAll: req.user.role === 'admin',
      canTargetRole: req.user.role === 'admin',
      teams,
      groups,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/announcements/sent — full management view, unfiltered by audience:
 * admins see every announcement ever posted company-wide; managers see only
 * the ones they authored themselves (same authorship boundary DELETE below
 * already enforces). This is what the dedicated Announcements page shows —
 * the drawer's GET / only shows what's addressed to the viewer.
 */
router.get('/sent', async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { authorId: req.user._id }
    const items = await Announcement.find(filter)
      .populate('authorId', 'name')
      .populate('audienceRootId', 'name')
      .sort({ createdAt: -1 })
      .limit(LIST_LIMIT)
    res.json(items.map((a) => a.toJSONSafe()))
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/announcements — compose.
 * Body: { title, body, type, audienceScope, audienceRole?, audienceRootId?, audienceGroupId? }
 */
router.post('/', async (req, res, next) => {
  try {
    const {
      title,
      body,
      type = 'announcement',
      audienceScope,
      audienceRole,
      audienceRootId,
      audienceGroupId,
    } = req.body || {}

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
    if (!['all', 'role', 'team', 'group'].includes(audienceScope)) {
      return res.status(400).json({ error: 'Choose who this is for.' })
    }

    let finalAudienceRole = null
    let finalRootId = null
    let finalGroupId = null

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
    } else if (audienceScope === 'team') {
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
    } else {
      // audienceScope === 'group' — a named project team.
      if (!mongoose.Types.ObjectId.isValid(audienceGroupId)) {
        return res.status(400).json({ error: 'Choose a valid team to target.' })
      }
      const group = await Team.findById(audienceGroupId)
      if (!group) return res.status(400).json({ error: 'Selected team no longer exists.' })
      if (req.user.role !== 'admin' && group.managerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'You can only broadcast to teams you created.' })
      }
      finalGroupId = audienceGroupId
    }

    const announcement = await Announcement.create({
      title: cleanTitle,
      body: cleanBody,
      type,
      authorId: req.user._id,
      audienceScope,
      audienceRole: finalAudienceRole,
      audienceRootId: finalRootId,
      audienceGroupId: finalGroupId,
      readBy: [req.user._id], // the author has implicitly seen their own post
    })
    if (finalGroupId) await announcement.populate('audienceGroupId', 'name')
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
