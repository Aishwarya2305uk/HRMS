import { useState } from 'react'
import { appSettings as appSettingsApi } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { useToast } from '../context/ToastContext'
import Icon from './Icon'
import { Skeleton, InlineError } from './States'

const URL_MAX = 2048

// Icons mirror the matching sidebar items so the pairing is obvious.
const FIELDS = [
  {
    key: 'feedbackFormUrl',
    label: 'Feedback form',
    icon: 'messageSquare',
    hint: 'Opens when anyone clicks "Feedback" at the bottom of the sidebar.',
  },
  {
    key: 'hrRequestFormUrl',
    label: 'HR request form',
    icon: 'lifeBuoy',
    hint: 'Opens when anyone clicks "HR Request" at the bottom of the sidebar.',
  },
]

/** Empty is fine (clears the link); anything else must be a full http(s) URL. */
function isValidLink(raw) {
  if (!raw) return true
  if (raw.length > URL_MAX) return false
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Admin editing of the org-wide external form links (Other Settings page).
 * Each setting is a collapsible row — header shows what it is and whether a
 * link is set; expanding it reveals the URL input. Each link saves
 * independently. Receives Portal's settings query so a save immediately
 * updates the same data the sidebar's Feedback / HR Request items open — no
 * refetch needed.
 */
export default function OtherSettingsManager({ query }) {
  const toast = useToast()
  const [drafts, setDrafts] = useState({})
  const [savingKey, setSavingKey] = useState(null)
  // Which accordion row is expanded (one at a time), or null for none.
  const [openKey, setOpenKey] = useState(null)

  const settings = query.data
  if (query.loading && settings === null) return <Skeleton rows={2} />
  if (query.error && settings === null) {
    return <InlineError onRetry={query.reload}>{query.error.message}</InlineError>
  }

  const valueFor = (key) => drafts[key] ?? settings?.[key] ?? ''
  const isDirty = (key) => valueFor(key).trim() !== (settings?.[key] ?? '')

  function toggle(key) {
    haptic('light')
    setOpenKey((k) => (k === key ? null : key))
  }

  async function save(field) {
    const val = valueFor(field.key).trim()
    if (!isValidLink(val)) {
      toast.error(`${field.label}: enter a full link starting with http:// or https://`)
      return
    }
    if (!isDirty(field.key)) return
    setSavingKey(field.key)
    haptic('medium')
    try {
      const updated = await appSettingsApi.update({ [field.key]: val })
      query.setData(updated)
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[field.key]
        return next
      })
      haptic('success')
      toast.success(
        val
          ? `${field.label} link saved — the sidebar option now opens it.`
          : `${field.label} link cleared — the sidebar option is disabled until a new one is set.`,
      )
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <section className="card pop" style={{ '--d': '40ms' }}>
      <div className="attendance__head">
        <h2>
          Feedback &amp; HR request forms
          <span className="settings-acc__count">{FIELDS.length} settings</span>
        </h2>
      </div>
      <p className="field-hint team-manager__hint">
        Everyone sees Feedback and HR Request at the bottom of their sidebar. Paste the form links
        (e.g. Google Forms) they should open — leave one empty to disable it for now.
      </p>

      <div className="settings-acc">
        {FIELDS.map((f) => {
          const open = openKey === f.key
          const isSet = Boolean((settings?.[f.key] ?? '').trim())
          return (
            <div className={`settings-acc__item${open ? ' is-open' : ''}`} key={f.key}>
              <button
                type="button"
                className="settings-acc__head"
                aria-expanded={open}
                aria-controls={`os-panel-${f.key}`}
                onClick={() => toggle(f.key)}
              >
                <span className="settings-acc__icon">
                  <Icon name={f.icon} size={17} />
                </span>
                <span className="settings-acc__text">
                  <strong>{f.label}</strong>
                  <em>{f.hint}</em>
                </span>
                <span className={`settings-acc__state${isSet ? ' is-set' : ''}`}>
                  {isSet ? 'Set' : 'Not set'}
                </span>
                <Icon name="chevronDown" size={16} className="settings-acc__chevron" />
              </button>

              {open && (
                <div className="settings-acc__body" id={`os-panel-${f.key}`}>
                  <form
                    className="field"
                    onSubmit={(e) => {
                      e.preventDefault()
                      save(f)
                    }}
                  >
                    <label htmlFor={`os-${f.key}`}>Form link</label>
                    <div className="leave-type-add">
                      <input
                        id={`os-${f.key}`}
                        type="url"
                        inputMode="url"
                        maxLength={URL_MAX}
                        value={valueFor(f.key)}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder="https://forms.gle/…"
                        aria-invalid={!isValidLink(valueFor(f.key).trim()) || undefined}
                      />
                      <button
                        type="submit"
                        className="btn-tactile primary sm"
                        disabled={savingKey === f.key || !isDirty(f.key)}
                      >
                        <Icon name="check" size={15} />
                        {savingKey === f.key ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
