import { Router } from 'express'
import mongoose from 'mongoose'
import { requireAuth } from '../middleware/auth.js'
import { User } from '../models/User.js'
import { Document, MAX_DOC_DATA_URL_LENGTH, DOC_DATA_URL_RE } from '../models/Document.js'

const router = Router()
router.use(requireAuth)

/**
 * The one access rule for an employee's documents (requirements: visible only
 * to the employee, their assigned manager, and admins). `owner` is the User
 * whose file the document sits on.
 */
function canViewDocuments(viewer, owner) {
  if (viewer.role === 'admin') return true
  if (owner._id.toString() === viewer._id.toString()) return true
  return Boolean(owner.managerId && owner.managerId.toString() === viewer._id.toString())
}

/** Loads the owner and 403s/404s per the rule above. Returns null if a
 *  response was already sent. */
async function loadAuthorizedOwner(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
    res.status(400).json({ error: 'Invalid employee id.' })
    return null
  }
  const owner = await User.findById(req.params.userId).select('managerId')
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
    const docs = await Document.find({ userId: owner._id })
      .populate('uploadedById', 'name')
      .sort({ createdAt: -1 })
    res.json(docs.map((d) => d.toJSONSafe()))
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
    const isSelf = req.params.userId === req.user._id.toString()
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
    const doc = await Document.create({
      userId: owner._id,
      name: trimmedName,
      mimeType: data.slice(5, data.indexOf(';')),
      size: Math.floor((base64.length * 3) / 4),
      dataUrl: data,
      uploadedById: req.user._id,
    })
    doc.uploadedById = req.user // so the response carries the uploader's name
    res.status(201).json(doc.toJSONSafe())
  } catch (err) {
    next(err)
  }
})

/** GET /api/documents/:id/file — the actual file content, for view/download.
 *  Same visibility rule as the listing. */
router.get('/:id/file', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid document id.' })
    }
    const doc = await Document.findById(req.params.id).populate('userId', 'managerId')
    if (!doc) return res.status(404).json({ error: 'Document not found.' })
    if (!canViewDocuments(req.user, doc.userId)) {
      return res.status(403).json({ error: 'You do not have access to this document.' })
    }
    res.json({ id: doc._id.toString(), name: doc.name, mimeType: doc.mimeType, dataUrl: doc.dataUrl })
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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid document id.' })
    }
    const doc = await Document.findById(req.params.id)
    if (!doc) return res.status(404).json({ error: 'Document not found.' })
    await doc.deleteOne()
    res.json({ id: req.params.id })
  } catch (err) {
    next(err)
  }
})

export default router
