import { Router } from 'express'
import { q } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { isValidId, announcementJSON } from '../store.js'
import { ancestorChain } from '../services/hierarchy.js'

const router = Router()
router.use(requireAuth)

const TITLE_MAX = 140
const BODY_MAX = 2000
const LIST_LIMIT = 100 // small internal user base — plenty of headroom, keeps the query bounded
const ROLES = ['employee', 'manager', 'admin']

/** The joins every listing uses: author/root/group display names attached. */
const ANNOUNCEMENT_WITH_NAMES = `
  select a.*, au.name as author_name, ru.name as audience_root_name,
         t.name as audience_group_name, t.member_ids as audience_group_member_ids
    from announcements a
    left join users au on au.id = a.author_id
    left join users ru on ru.id = a.audience_root_id
    left join teams t on t.id = a.audience_group_id`

/** Whether announcement row `a` reaches `viewer` (req.user), whose upward chain is `chain`. */
function matchesAudience(a, viewer, chain) {
  if (a.audience_scope === 'all') return true
  if (a.audience_scope === 'role') return a.audience_role === viewer.role
  if (a.audience_scope === 'group') {
    return (a.audience_group_member_ids ?? []).includes(viewer.id)
  }
  return a.audience_root_id ? chain.has(a.audience_root_id) : false
}

/**
 * GET /api/announcements — everything targeted at the current viewer
 * (urgent + regular), newest first, each carrying a per-viewer `read` flag.
 */
router.get('/', async (req, res, next) => {
  try {
    const [{ rows: all }, chain] = await Promise.all([
      q(`${ANNOUNCEMENT_WITH_NAMES} order by a.created_at desc limit ${LIST_LIMIT}`),
      ancestorChain(req.user.id),
    ])
    const mine = all.filter((a) => matchesAudience(a, req.user, chain))
    res.json(
      mine.map((a) => ({
        ...announcementJSON(a),
        read: (a.read_by || []).includes(req.user.id),
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
    const [{ rows: unread }, chain] = await Promise.all([
      q(`${ANNOUNCEMENT_WITH_NAMES} where not (a.read_by @> array[$1]::uuid[])`, [req.user.id]),
      ancestorChain(req.user.id),
    ])
    const ids = unread.filter((a) => matchesAudience(a, req.user, chain)).map((a) => a.id)
    if (ids.length) {
      // The @> re-check makes the append idempotent under concurrent calls.
      await q(
        `update announcements set read_by = read_by || $1::uuid
          where id = any($2) and not (read_by @> array[$1]::uuid[])`,
        [req.user.id, ids],
      )
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
    const { rows: users } = await q('select id, name, manager_id from users')
    const byId = new Map(users.map((u) => [u.id, u]))

    // For every user, walk their chain to the top; each ancestor's subtree
    // grows by one. Cheap in-memory pass since the whole roster is already
    // loaded (same scale assumption as the existing org-tree endpoint).
    const subtreeSize = new Map()
    for (const u of users) {
      const seen = new Set([u.id])
      let cursor = u.manager_id
      while (cursor && !seen.has(cursor)) {
        subtreeSize.set(cursor, (subtreeSize.get(cursor) || 0) + 1)
        seen.add(cursor)
        cursor = byId.get(cursor)?.manager_id ?? null
      }
    }

    const viewerId = req.user.id
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
    const { rows: ownTeams } = await q(
      'select id, name, member_ids from teams where manager_id = $1',
      [req.user.id],
    )
    const groups = ownTeams
      .map((t) => ({ id: t.id, name: t.name, size: (t.member_ids || []).length }))
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
    const where = req.user.role === 'admin' ? '' : 'where a.author_id = $1'
    const { rows } = await q(
      `${ANNOUNCEMENT_WITH_NAMES} ${where} order by a.created_at desc limit ${LIST_LIMIT}`,
      req.user.role === 'admin' ? [] : [req.user.id],
    )
    res.json(rows.map(announcementJSON))
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
    let groupName = null

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
      if (!isValidId(audienceRootId)) {
        return res.status(400).json({ error: 'Choose a valid team to target.' })
      }
      if (req.user.role === 'admin') {
        const { rows } = await q('select 1 from users where id = $1', [audienceRootId])
        if (!rows.length) return res.status(400).json({ error: 'Selected team no longer exists.' })
      } else {
        const chain = await ancestorChain(audienceRootId)
        if (!chain.has(req.user.id)) {
          return res.status(403).json({ error: 'You can only broadcast to your own team.' })
        }
      }
      finalRootId = audienceRootId
    } else {
      // audienceScope === 'group' — a named project team.
      if (!isValidId(audienceGroupId)) {
        return res.status(400).json({ error: 'Choose a valid team to target.' })
      }
      const { rows } = await q('select * from teams where id = $1', [audienceGroupId])
      const group = rows[0]
      if (!group) return res.status(400).json({ error: 'Selected team no longer exists.' })
      if (req.user.role !== 'admin' && group.manager_id !== req.user.id) {
        return res.status(403).json({ error: 'You can only broadcast to teams you created.' })
      }
      finalGroupId = audienceGroupId
      groupName = group.name
    }

    const { rows } = await q(
      `insert into announcements (title, body, type, author_id, audience_scope, audience_role,
                                  audience_root_id, audience_group_id, read_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, array[$4]::uuid[])
       returning *`,
      // read_by starts with the author — they've implicitly seen their own post.
      [cleanTitle, cleanBody, type, req.user.id, audienceScope, finalAudienceRole, finalRootId, finalGroupId],
    )
    console.log(`[announcements] ${req.user.email} posted "${cleanTitle}" (${audienceScope})`)
    res.status(201).json({
      ...announcementJSON({ ...rows[0], audience_group_name: groupName }),
      authorName: req.user.name,
      read: true,
    })
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
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid announcement id.' })
    }
    const { rows } = await q('select * from announcements where id = $1', [req.params.id])
    const item = rows[0]
    if (!item) return res.status(404).json({ error: 'Announcement not found.' })
    if (req.user.role !== 'admin' && item.author_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only remove announcements you posted.' })
    }
    await q('delete from announcements where id = $1', [req.params.id])
    console.log(`[announcements] ${req.user.email} removed announcement ${req.params.id}`)
    res.json({ id: req.params.id })
  } catch (err) {
    next(err)
  }
})

export default router
