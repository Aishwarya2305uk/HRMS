import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import Avatar from './Avatar'
import Modal from './Modal'
import DocumentsCard from './DocumentsCard'
import { InlineError } from './States'
import { useToast } from '../context/ToastContext'
import { useAsyncData } from '../lib/useAsyncData'
import { haptic } from '../lib/haptics'
import { formatDate } from '../lib/format'
import { employees as employeesApi, employmentTypes as employmentTypesApi } from '../lib/hrms'

const PHONE_RE = /^[0-9+\-\s()]{7,20}$/
const AADHAR_RE = /^\d{12}$/
const MAX_NAME_LENGTH = 80 // mirrors the server cap in routes/employees.js
const MAX_IMAGE_DIM = 480
const MAX_SOURCE_IMAGE_BYTES = 8_000_000 // reject absurd source files before we even try to read them

const digitsOnly = (v) => (v || '').replace(/\D/g, '')

/** "123456789012" -> "1234 5678 9012" */
function formatAadhar(value) {
  const d = digitsOnly(value)
  return d.match(/.{1,4}/g)?.join(' ') ?? d
}

/** "123456789012" -> "•••• •••• 9012" */
function maskAadhar(value) {
  const d = digitsOnly(value)
  if (d.length !== 12) return '—'
  return `•••• •••• ${d.slice(-4)}`
}

/** Resize/compress a chosen image client-side so uploads stay small, returning a JPEG data URL. */
function fileToCompressedDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Couldn't read that file."))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error("That doesn't look like a valid image."))
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale) || 1
        const h = Math.round(img.height * scale) || 1
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Personal-details page for one person — the logged-in user's own profile,
 * or (for admins) any employee's. Portal.jsx supplies `profile` already
 * loaded and authorized; this component only ever renders, validates, and
 * PATCHes `/employees/:id/profile`.
 *
 * @param {object}   props.profile               result of employees.profile(id) (toProfileJSON() + managerName + employmentTypeName)
 * @param {boolean}  props.isSelf                true when viewing your own profile
 * @param {boolean}  props.canEdit               true for self, or an admin viewing someone else — gates the personal-details fields
 * @param {boolean}  props.canEditName           admin-only, even on your own profile — the display name is HR record data (an admin entered it when creating the account); adds a Full name field to the edit form
 * @param {boolean}  props.canEditEmploymentType admin-only, even on your own profile — employment type is HR classification, not a personal detail
 * @param {Function} props.onSaved               (updatedProfile) => void
 * @param {Function} [props.onBack]               present only when viewing someone else's profile
 */
export default function Profile({ profile, isSelf, canEdit, canEditName, canEditEmploymentType, onSaved, onBack }) {
  const toast = useToast()
  // A half-edited form survives a page refresh (per tab, per user — see
  // lib/useSessionState.js), remembered per PERSON being edited so an admin
  // browsing People never sees one employee's draft on another's page.
  const draftKey = `draft.profile.${profile?.id ?? 'none'}`
  const [editingFlag, setEditing] = useSessionState(`${draftKey}.editing`, false)
  const [form, setForm] = useSessionState(`${draftKey}.form`, null)
  // Both halves must have come back for the form to be shown.
  const editing = editingFlag && form !== null
  const [revealAadhar, setRevealAadhar] = useState(false)
  const [touched, setTouched] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  // Employment type is a separate, admin-only edit affordance — the
  // Employment block is otherwise pure display, so this gets its own tiny
  // bit of state rather than folding into the personal-details form above.
  const employmentTypesQ = useAsyncData(useCallback(() => employmentTypesApi.list(), []), {
    enabled: canEditEmploymentType,
  })
  const employmentTypeOptions = employmentTypesQ.data ?? []
  const [editingEmploymentType, setEditingEmploymentType] = useState(false)
  const [employmentTypeDraft, setEmploymentTypeDraft] = useState('')
  const [confirmingEmploymentType, setConfirmingEmploymentType] = useState(false)
  const [savingEmploymentType, setSavingEmploymentType] = useState(false)

  // Switching to a different person (admin browsing People) should never
  // leave a revealed Aadhar number, a stale error or a half-done employment
  // type change on screen. The edit form itself is keyed per person above, so
  // it can't leak between people and needs no reset here.
  useEffect(() => {
    setRevealAadhar(false)
    setSubmitError('')
    setTouched({})
    setEditingEmploymentType(false)
    setConfirmingEmploymentType(false)
  }, [profile?.id])

  function startEdit() {
    setForm({
      name: profile.name || '',
      phone: profile.phone || '',
      dob: profile.dob ? profile.dob.slice(0, 10) : '',
      address: profile.address || '',
      education: profile.education || '',
      aadharNumber: profile.aadharNumber || '',
      photoUrl: profile.photoUrl || '',
    })
    setTouched({})
    setSubmitError('')
    setEditing(true)
    haptic('light')
  }

  function cancelEdit() {
    setEditing(false)
    setForm(null)
  }

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }
  function markTouched(field) {
    setTouched((t) => ({ ...t, [field]: true }))
  }

  async function onPickPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // so picking the same file again still fires onChange
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.')
      return
    }
    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
      toast.error('That image is too large. Please pick one under 8MB.')
      return
    }
    try {
      const dataUrl = await fileToCompressedDataUrl(file)
      update('photoUrl', dataUrl)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const errors = useMemo(() => {
    if (!form) return {}
    const e = {}
    if (canEditName) {
      const name = form.name.trim()
      if (!name) e.name = 'Enter a full name.'
      else if (name.length > MAX_NAME_LENGTH) e.name = `Keep the name under ${MAX_NAME_LENGTH} characters.`
    }
    if (form.phone.trim() && !PHONE_RE.test(form.phone.trim())) {
      e.phone = 'Enter a valid phone number.'
    }
    if (form.dob) {
      const d = new Date(form.dob)
      if (Number.isNaN(d.getTime()) || d > new Date()) e.dob = 'Enter a valid date of birth.'
    }
    if (form.aadharNumber.trim() && !AADHAR_RE.test(digitsOnly(form.aadharNumber))) {
      e.aadharNumber = 'Aadhar number must be exactly 12 digits.'
    }
    if (form.address.length > 300) e.address = 'Keep the address under 300 characters.'
    if (form.education.length > 500) e.education = 'Keep this under 500 characters.'
    return e
  }, [form, canEditName])

  // Portal wraps us in <Section query={profileQ}>, which normally only ever
  // mounts this component once data has arrived — except for one transitional
  // render right as the tab switches in, before useAsyncData's `loading` flag
  // has caught up (see useAsyncData.js: it only flips on the next effect
  // tick). Bail out for that one frame rather than crashing on `profile.*`.
  if (!profile) return null

  const isValid = Object.keys(errors).length === 0
  const showError = (field) => (touched[field] || touched._submitted) && errors[field]

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError('')
    setTouched((t) => ({ ...t, _submitted: true }))
    if (!isValid) return

    setSaving(true)
    haptic('medium')
    try {
      const payload = {
        phone: form.phone.trim(),
        dob: form.dob,
        address: form.address.trim(),
        education: form.education.trim(),
        aadharNumber: digitsOnly(form.aadharNumber),
      }
      // Only re-upload the photo when it actually changed — it's the one
      // field big enough to matter for a save that touched nothing else.
      if (form.photoUrl !== (profile.photoUrl || '')) payload.photoUrl = form.photoUrl
      // Name is admin-only server-side, so it's only ever sent when this
      // admin actually changed it — never as an unchanged passenger on a
      // regular save (which the server would still accept, but needlessly).
      if (canEditName && form.name.trim() !== profile.name) payload.name = form.name.trim()

      const updated = await employeesApi.updateProfile(profile.id, payload)
      haptic('success')
      toast.success('Profile updated.')
      setEditing(false)
      setForm(null)
      onSaved?.(updated)
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function startEditEmploymentType() {
    setEmploymentTypeDraft(profile.employmentType || '')
    setEditingEmploymentType(true)
    haptic('light')
  }

  function cancelEditEmploymentType() {
    setEditingEmploymentType(false)
    setConfirmingEmploymentType(false)
  }

  /** Nothing to confirm if it didn't actually change — just close. */
  function requestSaveEmploymentType(e) {
    e.preventDefault()
    if ((employmentTypeDraft || null) === (profile.employmentType || null)) {
      setEditingEmploymentType(false)
      return
    }
    setConfirmingEmploymentType(true)
  }

  async function confirmSaveEmploymentType() {
    setSavingEmploymentType(true)
    haptic('medium')
    try {
      const updated = await employeesApi.updateProfile(profile.id, {
        employmentType: employmentTypeDraft || null,
      })
      haptic('success')
      toast.success('Employment type updated — leave balance reset to the new policy.')
      setEditingEmploymentType(false)
      setConfirmingEmploymentType(false)
      onSaved?.(updated)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingEmploymentType(false)
    }
  }

  // While editing, the preview IS the form's photo (a freshly picked file
  // becomes a data URL there) — no separate preview state to fall out of step.
  const displayPhoto = editing ? form.photoUrl : profile.photoUrl
  // Same live-preview treatment the photo gets: while an admin types a new
  // name, the hero heading and avatar initials follow along.
  const displayName = editing && canEditName ? form.name.trim() || profile.name : profile.name

  return (
    <div className="profile-page">
      {!isSelf && onBack && (
        <button type="button" className="btn-tactile ghost sm profile-back" onClick={onBack}>
          <Icon name="chevronLeft" size={15} />
          Back to People
        </button>
      )}

      <section className="card pop profile-hero" style={{ '--d': '60ms' }}>
        <div className="profile-hero__photo">
          <Avatar name={displayName} photoUrl={displayPhoto} size="xl" />
          {editing && (
            <>
              <button
                type="button"
                className="icon-btn sm profile-hero__photo-btn"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Change photo"
                title="Change photo"
              >
                <Icon name="camera" size={15} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onPickPhoto}
                className="sr-only"
                aria-label="Upload profile photo"
              />
            </>
          )}
        </div>

        <div className="profile-hero__text">
          <h2>{displayName}</h2>
          <div className="profile-hero__tags">
            <span className={`role-pill ${profile.role}`}>{profile.role}</span>
            {profile.designation && <span>{profile.designation}</span>}
            {profile.department && <span>· {profile.department}</span>}
          </div>
          <div className="profile-hero__ident">
            {profile.employeeId && (
              <span className="profile-hero__ident-item">
                <Icon name="idCard" size={13} />
                {profile.employeeId}
              </span>
            )}
            <span className="profile-hero__ident-item">
              <Icon name="mail" size={13} />
              {profile.email}
            </span>
          </div>
        </div>

        {canEdit && !editing && (
          <button type="button" className="btn-tactile ghost sm profile-hero__edit" onClick={startEdit}>
            <Icon name="edit" size={15} />
            Edit details
          </button>
        )}
      </section>

      {submitError && <InlineError>{submitError}</InlineError>}

      {editing ? (
        <form className="card pop profile-form" style={{ '--d': '120ms' }} onSubmit={handleSubmit} noValidate>
          {canEditName && (
            <div className="field">
              <label htmlFor="pf-name">Full name</label>
              <input
                id="pf-name"
                value={form.name}
                maxLength={MAX_NAME_LENGTH}
                autoComplete="off"
                onChange={(e) => update('name', e.target.value)}
                onBlur={() => markTouched('name')}
                aria-invalid={Boolean(showError('name'))}
                placeholder="Jane Doe"
              />
              {showError('name') ? (
                <p className="field-error">{errors.name}</p>
              ) : (
                <p className="field-hint">Shown everywhere across Orbit — the header, People, leaves and attendance.</p>
              )}
            </div>
          )}

          <div className="field-row">
            <div className="field">
              <label htmlFor="pf-phone">Phone number</label>
              <input
                id="pf-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                onBlur={() => markTouched('phone')}
                aria-invalid={Boolean(showError('phone'))}
                placeholder="+91 98765 43210"
              />
              {showError('phone') && <p className="field-error">{errors.phone}</p>}
            </div>
            <div className="field">
              <label htmlFor="pf-dob">Date of birth</label>
              <input
                id="pf-dob"
                type="date"
                value={form.dob}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => update('dob', e.target.value)}
                onBlur={() => markTouched('dob')}
                aria-invalid={Boolean(showError('dob'))}
              />
              {showError('dob') && <p className="field-error">{errors.dob}</p>}
            </div>
          </div>

          <div className="field">
            <label htmlFor="pf-address">
              Address <span className="field-optional">(optional)</span>
            </label>
            <textarea
              id="pf-address"
              rows={2}
              maxLength={300}
              value={form.address}
              onChange={(e) => update('address', e.target.value)}
            />
            {showError('address') && <p className="field-error">{errors.address}</p>}
          </div>

          <div className="field">
            <label htmlFor="pf-education">
              Education <span className="field-optional">(optional)</span>
            </label>
            <textarea
              id="pf-education"
              rows={3}
              maxLength={500}
              value={form.education}
              placeholder="Degree, institution, year…"
              onChange={(e) => update('education', e.target.value)}
            />
            {showError('education') && <p className="field-error">{errors.education}</p>}
          </div>

          <div className="field">
            <label htmlFor="pf-aadhar">
              Aadhar number <span className="field-optional">(optional)</span>
            </label>
            <input
              id="pf-aadhar"
              inputMode="numeric"
              value={form.aadharNumber}
              maxLength={14}
              onChange={(e) => update('aadharNumber', e.target.value)}
              onBlur={() => markTouched('aadharNumber')}
              aria-invalid={Boolean(showError('aadharNumber'))}
              placeholder="12-digit Aadhar number"
            />
            {showError('aadharNumber') ? (
              <p className="field-error">{errors.aadharNumber}</p>
            ) : (
              <p className="field-hint">Kept private — only you and HR admins can see this.</p>
            )}
          </div>

          <div className="modal__actions">
            <button type="button" className="btn-tactile ghost" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-tactile primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      ) : (
        <section className="card pop profile-details" style={{ '--d': '120ms' }}>
          <h3>Personal details</h3>
          <dl className="profile-facts">
            <div>
              <dt>Email</dt>
              <dd>{profile.email}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{profile.phone || '—'}</dd>
            </div>
            <div>
              <dt>Date of birth</dt>
              <dd>{profile.dob ? formatDate(profile.dob, true) : '—'}</dd>
            </div>
            <div>
              <dt>Aadhar number</dt>
              <dd className="profile-aadhar">
                <span>{profile.aadharNumber ? (revealAadhar ? formatAadhar(profile.aadharNumber) : maskAadhar(profile.aadharNumber)) : '—'}</span>
                {profile.aadharNumber && (
                  <button
                    type="button"
                    className="profile-aadhar__toggle"
                    onClick={() => setRevealAadhar((v) => !v)}
                    aria-label={revealAadhar ? 'Hide Aadhar number' : 'Show Aadhar number'}
                  >
                    <Icon name={revealAadhar ? 'eyeOff' : 'eye'} size={14} />
                  </button>
                )}
              </dd>
            </div>
            <div className="profile-facts__wide">
              <dt>Address</dt>
              <dd>{profile.address || '—'}</dd>
            </div>
            <div className="profile-facts__wide">
              <dt>Education</dt>
              <dd>{profile.education || '—'}</dd>
            </div>
          </dl>
        </section>
      )}

      <section className="card pop profile-details" style={{ '--d': '180ms' }}>
        <div className="profile-details__head">
          <h3>Employment</h3>
          {canEditEmploymentType && !editingEmploymentType && (
            <button
              type="button"
              className="icon-btn sm"
              onClick={startEditEmploymentType}
              aria-label="Edit employment type"
              title="Edit employment type"
            >
              <Icon name="edit" size={14} />
            </button>
          )}
        </div>
        <dl className="profile-facts">
          <div>
            <dt>Employee ID</dt>
            <dd>{profile.employeeId || '—'}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{profile.email}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd><span className={`role-pill ${profile.role}`}>{profile.role}</span></dd>
          </div>
          <div>
            <dt>Employment type</dt>
            <dd>
              {editingEmploymentType ? (
                <form className="profile-inline-edit" onSubmit={requestSaveEmploymentType}>
                  <select
                    value={employmentTypeDraft}
                    onChange={(e) => setEmploymentTypeDraft(e.target.value)}
                    disabled={savingEmploymentType}
                    aria-label="Employment type"
                  >
                    <option value="">— None —</option>
                    {employmentTypeOptions.map((et) => (
                      <option key={et.id} value={et.id}>{et.name}</option>
                    ))}
                  </select>
                  <button type="submit" className="btn-tactile primary sm" disabled={savingEmploymentType}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn-tactile ghost sm"
                    onClick={cancelEditEmploymentType}
                    disabled={savingEmploymentType}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                profile.employmentTypeName || '—'
              )}
            </dd>
          </div>
          <div>
            <dt>Designation</dt>
            <dd>{profile.designation || '—'}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{profile.department || '—'}</dd>
          </div>
          <div>
            <dt>Joined</dt>
            <dd>{profile.joiningDate ? formatDate(profile.joiningDate, true) : '—'}</dd>
          </div>
          <div>
            <dt>Reports to</dt>
            <dd>{profile.managerName || '—'}</dd>
          </div>
        </dl>
      </section>

      {/* Documents on this person's HR file. canEdit already captures "self
          or an admin viewing someone else" — exactly who may upload here;
          canEditEmploymentType is the existing admin-only flag, reused for
          the admin-only delete right. */}
      <DocumentsCard
        userId={profile.id}
        canUpload={canEdit}
        canDelete={canEditEmploymentType}
        title={isSelf ? 'My documents' : 'Documents'}
      />

      {confirmingEmploymentType && (
        <Modal titleId="confirm-employment-type-title" onClose={cancelEditEmploymentType}>
          <div className="modal__head">
            <h2 id="confirm-employment-type-title">Change employment type?</h2>
          </div>
          <p>
            Changing {isSelf ? 'your' : `${profile.name}'s`} employment type resets{' '}
            {isSelf ? 'your' : 'their'} leave balance to the new policy's quotas — any unused
            balance under the current type is lost.
          </p>
          <div className="modal__actions">
            <button
              type="button"
              className="btn-tactile ghost"
              onClick={cancelEditEmploymentType}
              disabled={savingEmploymentType}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-tactile danger"
              onClick={confirmSaveEmploymentType}
              disabled={savingEmploymentType}
            >
              {savingEmploymentType ? 'Saving…' : 'Yes, change it'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
