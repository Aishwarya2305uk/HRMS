import { useCallback, useRef, useState } from 'react'
import Icon from './Icon'
import Modal from './Modal'
import { Skeleton, EmptyState, InlineError } from './States'
import { useToast } from '../context/ToastContext'
import { useAsyncData } from '../lib/useAsyncData'
import { documents as documentsApi } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { formatDate, formatBytes } from '../lib/format'

const MAX_DOC_BYTES = 3_000_000
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xlsx'
const ALLOWED_MIME_RE =
  /^(application\/pdf|image\/(png|jpe?g|webp)|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))$/i

/** Short human label for a document's format, derived from its MIME type. */
function typeLabel(mimeType) {
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType?.startsWith('image/')) return mimeType.slice(6).toUpperCase()
  if (mimeType?.includes('spreadsheetml')) return 'Excel'
  if (mimeType?.includes('wordprocessingml') || mimeType === 'application/msword') return 'Word'
  return 'File'
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',')
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'))
  const bin = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * An employee's HR-file documents (ID proofs, certificates, contracts…) —
 * shown on the dashboard (your own) and on the profile page (yours, or the
 * viewed employee's for an admin). The server enforces who can see the list
 * at all: the employee, their direct manager, and admins.
 *
 * Uploading deliberately does NOT save on file pick: the chosen file first
 * opens a verification dialog (name, type, size, image preview) with
 * Save / Cancel / "choose a different file", so the wrong attachment never
 * lands on a personnel record by accident.
 *
 * @param {string}  props.userId     whose documents to show
 * @param {boolean} props.canUpload  self or admin
 * @param {boolean} props.canDelete  admin only
 * @param {string}  [props.title]
 */
export default function DocumentsCard({ userId, canUpload, canDelete, title = 'Documents' }) {
  const toast = useToast()
  const docsQ = useAsyncData(
    useCallback(() => documentsApi.list(userId), [userId]),
    { enabled: Boolean(userId) },
  )
  const docs = docsQ.data ?? []

  const fileInputRef = useRef(null)
  // The picked-but-not-yet-saved file shown in the verification dialog.
  const [pendingFile, setPendingFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  function onPickFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // picking the same file again should still fire onChange
    if (!file) return
    if (!ALLOWED_MIME_RE.test(file.type)) {
      toast.error('Only PDF, image, Word or Excel files are supported.')
      return
    }
    if (file.size > MAX_DOC_BYTES) {
      toast.error('That file is too large. Please keep documents under 3MB.')
      return
    }
    const reader = new FileReader()
    reader.onerror = () => toast.error("Couldn't read that file.")
    reader.onload = () => {
      setSaveError('')
      setPendingFile({ name: file.name, mimeType: file.type, size: file.size, dataUrl: reader.result })
    }
    reader.readAsDataURL(file)
  }

  function cancelPending() {
    setPendingFile(null)
    setSaveError('')
  }

  async function savePending() {
    setSaving(true)
    setSaveError('')
    haptic('medium')
    try {
      const doc = await documentsApi.upload(userId, {
        name: pendingFile.name,
        dataUrl: pendingFile.dataUrl,
      })
      haptic('success')
      docsQ.setData((prev) => [doc, ...(prev ?? [])])
      setPendingFile(null)
      toast.success('Document saved.')
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  /** Open viewable formats (PDF/images) in a new tab; download the rest. */
  async function openDocument(doc) {
    setBusyId(doc.id)
    try {
      const file = await documentsApi.file(doc.id)
      const url = URL.createObjectURL(dataUrlToBlob(file.dataUrl))
      const viewable = file.mimeType === 'application/pdf' || file.mimeType.startsWith('image/')
      if (viewable) {
        window.open(url, '_blank', 'noopener')
      } else {
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete(doc) {
    setBusyId(doc.id)
    try {
      await documentsApi.remove(doc.id)
      haptic('light')
      docsQ.setData((prev) => (prev ?? []).filter((d) => d.id !== doc.id))
      setConfirmingDeleteId(null)
      toast.success('Document deleted.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="card docs-card pop" style={{ '--d': '200ms' }}>
      <div className="attendance__head">
        <h2>{title}</h2>
        <div className="attendance__head-actions">
          {docs.length > 0 && <span className="count-pill">{docs.length}</span>}
          {canUpload && (
            <>
              <button
                type="button"
                className="btn-tactile primary sm"
                onClick={() => { haptic('light'); fileInputRef.current?.click() }}
              >
                <Icon name="upload" size={15} />
                Upload
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                onChange={onPickFile}
                className="sr-only"
                aria-label="Choose a document to upload"
              />
            </>
          )}
        </div>
      </div>

      <p className="docs-card__hint">
        Visible only to you, your manager and HR admins.
        {canDelete ? ' Documents can be deleted by admins.' : ' Only an admin can delete a document.'}
      </p>

      {docsQ.loading && docsQ.data === null ? (
        <Skeleton rows={2} />
      ) : docsQ.error && docsQ.data === null ? (
        <InlineError onRetry={docsQ.reload}>{docsQ.error.message}</InlineError>
      ) : docs.length === 0 ? (
        <EmptyState
          icon="fileText"
          title="No documents yet"
          message={
            canUpload
              ? 'Upload ID proofs, certificates or contracts to keep them on this HR file.'
              : 'Documents uploaded to this HR file will appear here.'
          }
          action={canUpload ? { label: 'Upload a document', onClick: () => fileInputRef.current?.click() } : undefined}
        />
      ) : (
        <ul className="doc-list">
          {docs.map((d) => {
            const busy = busyId === d.id
            const confirming = confirmingDeleteId === d.id
            return (
              <li key={d.id} className="doc-row">
                <span className="doc-row__icon">
                  <Icon name="fileText" size={18} />
                </span>
                <div className="doc-row__meta">
                  <strong>{d.name}</strong>
                  <em>
                    {typeLabel(d.mimeType)} · {formatBytes(d.size)} · Uploaded {formatDate(d.createdAt, true)}
                    {d.uploadedByName ? ` by ${d.uploadedByName}` : ''}
                  </em>
                </div>
                <div className="doc-row__actions">
                  {confirming ? (
                    <span className="req__confirm">
                      <span>Delete?</span>
                      <button
                        type="button"
                        className="btn-tactile danger sm"
                        disabled={busy}
                        onClick={() => confirmDelete(d)}
                      >
                        {busy ? 'Deleting…' : 'Yes, delete'}
                      </button>
                      <button
                        type="button"
                        className="btn-tactile ghost sm"
                        disabled={busy}
                        onClick={() => setConfirmingDeleteId(null)}
                      >
                        Keep it
                      </button>
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="icon-btn sm"
                        onClick={() => openDocument(d)}
                        disabled={busy}
                        aria-label={`Open ${d.name}`}
                        title="View / download"
                      >
                        <Icon name="download" size={15} />
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          className="icon-btn sm doc-row__delete"
                          onClick={() => setConfirmingDeleteId(d.id)}
                          aria-label={`Delete ${d.name}`}
                          title="Delete (admin)"
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {pendingFile && (
        <Modal titleId="doc-confirm-title" onClose={saving ? () => {} : cancelPending}>
          <div className="modal__head">
            <h2 id="doc-confirm-title">Save this document?</h2>
            <button
              className="icon-btn sm"
              onClick={cancelPending}
              disabled={saving}
              aria-label="Close dialog"
            >
              <Icon name="x" size={16} />
            </button>
          </div>

          {saveError && <InlineError>{saveError}</InlineError>}

          <div className="doc-confirm">
            {pendingFile.mimeType.startsWith('image/') ? (
              <img className="doc-confirm__preview" src={pendingFile.dataUrl} alt={`Preview of ${pendingFile.name}`} />
            ) : (
              <span className="doc-confirm__icon">
                <Icon name="fileText" size={26} />
              </span>
            )}
            <div className="doc-confirm__meta">
              <strong>{pendingFile.name}</strong>
              <em>{typeLabel(pendingFile.mimeType)} · {formatBytes(pendingFile.size)}</em>
            </div>
          </div>

          <p className="docs-card__hint">
            Check this is the right file — once saved it stays on the HR file and only an admin
            can delete it.
          </p>

          <div className="modal__actions doc-confirm__actions">
            <button
              type="button"
              className="btn-tactile ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving}
            >
              <Icon name="refreshCw" size={15} />
              Choose a different file
            </button>
            <button type="button" className="btn-tactile ghost" onClick={cancelPending} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn-tactile primary" onClick={savePending} disabled={saving}>
              {saving ? 'Saving…' : 'Save document'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
