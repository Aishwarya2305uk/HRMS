import { Router } from 'express'
import { q } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { isValidId, documentJSON } from '../store.js'

const router = Router()
router.use(requireAuth)

// ~3MB decoded (base64 inflates ~4/3). Stored inline as a data URL, same
// approach as users.photo_url — no separate file store to operate.
export const MAX_DOC_DATA_URL_LENGTH = 4_200_000

/** Allowed upload formats — documents an HR file actually needs (ID proofs,
 *  certificates, contracts), not arbitrary executables. */
export const DOC_DATA_URL_RE =
  /^data:(application\/pdf|image\/(png|jpe?g|webp)|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet));base64,/i

/**
 * The one access rule for an employee's documents (requirements: visible only
 * to the employee, their assigned manager, and admins). `owner` is the user
 * whose file the document sits on.
 */
function canViewDocuments(viewer, owner) {
  if (viewer.role === 'admin') return true
  if (owner.id === viewer.id) return true
  return Boolean(owner.manager_id && owner.manager_id === viewer.id)
}

/** Loads the owner and 403s/404s per the rule above. Returns null if a
 *  response was already sent. */
async function loadAuthorizedOwner(req, res) {
  if (!isValidId(req.params.userId)) {
    res.status(400).json({ error: 'Invalid employee id.' })
    return null
  }
  const { rows } = await q('select id, manager_id from users where id = $1', [req.params.userId])
  const owner = rows[0]
  if (!owner) {
    res.status(404).json({ error: 'Employee not found.' })
    return null
  }
  if (!canViewDocuments(req.user, owner)) {
    res.status(403).json({ error: 'You do not have access to these documents.' })
    return null
  }
  return owner
}

/** GET /api/documents/user/:userId — that employee's documents (metadata
 *  only; the file itself is fetched per-document below). */
router.get('/user/:userId', async (req, res, next) => {
  try {
    const owner = await loadAuthorizedOwner(req, res)
    if (!owner) return
    const { rows } = await q(
      `select d.id, d.user_id, d.name, d.mime_type, d.size, d.created_at,
              u.name as uploaded_by_name
         from documents d
         left join users u on u.id = d.uploaded_by_id
        where d.user_id = $1
        order by d.created_at desc`,
      [owner.id],
    )
    res.json(rows.map(documentJSON))
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/documents/user/:userId — add a document to an employee's file.
 * Body: { name, dataUrl }. The employee may upload to their own file; an
 * admin may upload to anyone's. A manager can VIEW their reports' documents
 * but not add to them — uploads change someone's HR record.
 */
router.post('/user/:userId', async (req, res, next) => {
  try {
    const isSelf = req.params.userId === req.user.id
    if (!isSelf && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only upload documents to your own file.' })
    }
    const owner = await loadAuthorizedOwner(req, res)
    if (!owner) return

    const { name, dataUrl } = req.body || {}
    const trimmedName = String(name || '').trim()
    if (!trimmedName) {
      return res.status(400).json({ error: 'The document needs a file name.' })
    }
    if (trimmedName.length > 200) {
      return res.status(400).json({ error: 'File name must be under 200 characters.' })
    }
    const data = String(dataUrl || '')
    if (!DOC_DATA_URL_RE.test(data)) {
      return res.status(400).json({ error: 'Only PDF, image, Word or Excel files are supported.' })
    }
    if (data.length > MAX_DOC_DATA_URL_LENGTH) {
      return res.status(400).json({ error: 'That file is too large. Please keep documents under ~3MB.' })
    }

    const base64 = data.slice(data.indexOf(',') + 1)
    const { rows } = await q(
      `insert into documents (user_id, name, mime_type, size, data_url, uploaded_by_id)
       values ($1, $2, $3, $4, $5, $6)
       returning id, user_id, name, mime_type, size, created_at`,
      [
        owner.id,
        trimmedName,
        data.slice(5, data.indexOf(';')),
        Math.floor((base64.length * 3) / 4),
        data,
        req.user.id,
      ],
    )
    // so the response carries the uploader's name
    res.status(201).json(documentJSON({ ...rows[0], uploaded_by_name: req.user.name }))
  } catch (err) {
    next(err)
  }
})

/** GET /api/documents/:id/file — the actual file content, for view/download.
 *  Same visibility rule as the listing. */
router.get('/:id/file', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid document id.' })
    }
    const { rows } = await q(
      `select d.*, u.id as owner_id, u.manager_id as owner_manager_id
         from documents d
         join users u on u.id = d.user_id
        where d.id = $1`,
      [req.params.id],
    )
    const doc = rows[0]
    if (!doc) return res.status(404).json({ error: 'Document not found.' })
    if (!canViewDocuments(req.user, { id: doc.owner_id, manager_id: doc.owner_manager_id })) {
      return res.status(403).json({ error: 'You do not have access to this document.' })
    }
    res.json({ id: doc.id, name: doc.name, mimeType: doc.mime_type, dataUrl: doc.data_url })
  } catch (err) {
    next(err)
  }
})

/** DELETE /api/documents/:id — admins only (per requirements — even the
 *  employee can't remove items from their own HR file). */
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can delete documents.' })
    }
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid document id.' })
    }
    const { rowCount } = await q('delete from documents where id = $1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Document not found.' })
    res.json({ id: req.params.id })
  } catch (err) {
    next(err)
  }
})

export default router
