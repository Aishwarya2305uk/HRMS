import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { invites } from '../lib/hrms'
import Icon from '../components/Icon'
import './Auth.css'

const MIN_PASSWORD = 8
const ROLE_HOME = { admin: '/admin/dashboard' }

/** Accepts a raw invite token or a full pasted invite link and returns the token. */
function extractToken(input) {
  const value = String(input || '').trim()
  if (!value) return ''
  try {
    return new URL(value).searchParams.get('token') || value
  } catch {
    return value
  }
}

/**
 * Invite-only registration at /signup. There is no open sign-up: an admin
 * adds the person first (People page), which creates the account as a
 * pending invite; this page turns that invite into a working account —
 * the person sets their own password (and optionally personal details)
 * and is signed straight in.
 *
 * With no ?token in the URL it explains the invite-only policy and lets the
 * person paste the invite link/code their admin shared.
 */
export default function SignUp() {
  const { adoptSession } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const token = params.get('token') || ''

  // Invite lookup: null = loading, {error} = bad token, {name,email,...} = ok.
  const [invite, setInvite] = useState(null)
  const [lookupError, setLookupError] = useState('')
  const [pasted, setPasted] = useState('')

  const [form, setForm] = useState({ password: '', confirm: '', phone: '', dob: '', address: '' })
  const [touched, setTouched] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    let active = true
    setInvite(null)
    setLookupError('')
    invites
      .lookup(token)
      .then((data) => active && setInvite(data))
      .catch((err) => active && setLookupError(err.message))
    return () => {
      active = false
    }
  }, [token])

  const errors = useMemo(() => {
    const e = {}
    if (!form.password) e.password = 'Create a password.'
    else if (form.password.length < MIN_PASSWORD) {
      e.password = `Use at least ${MIN_PASSWORD} characters.`
    }
    if (form.confirm !== form.password) e.confirm = 'Passwords don’t match.'
    return e
  }, [form])

  const isValid = Object.keys(errors).length === 0
  const showError = (f) => (touched[f] || touched._submitted) && errors[f]

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError('')
    setTouched((t) => ({ ...t, _submitted: true }))
    if (!isValid) {
      document.getElementById(errors.password ? 'su-password' : 'su-confirm')?.focus()
      return
    }
    setSubmitting(true)
    try {
      const { token: jwt, user } = await invites.register({
        token,
        password: form.password,
        phone: form.phone || undefined,
        dob: form.dob || undefined,
        address: form.address || undefined,
      })
      adoptSession(jwt, user)
      navigate(ROLE_HOME[user.role] ?? '/dashboard', { replace: true })
    } catch (err) {
      setSubmitError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="auth">
      {/* Left: brand panel — same as the login page. */}
      <aside className="auth__brand">
        <Link className="brand__logo" to="/" aria-label="Go to sign in">
          <span className="mark">
            <img src="/logo.svg" alt="" />
          </span>
          <span className="brand__wordmark">
            <strong>ORBIT</strong>
            <em>by Trula.ai</em>
          </span>
        </Link>

        <div className="brand__intro">
          <h1>Welcome aboard.</h1>
          <p>Finish setting up your account and step into your workspace.</p>
        </div>

        <blockquote className="brand__quote">
          <p>&ldquo;Alone we can do so little; together we can do so much.&rdquo;</p>
          <cite>Helen Keller</cite>
        </blockquote>
      </aside>

      {/* Right: the sign-up card. */}
      <main className="auth__panel">
        <div className="auth-card">
          {!token ? (
            /* ---- Standalone registration entry: enter/paste the invite ---- */
            <>
              <span className="auth-card__badge">Register</span>
              <h2>Create your account</h2>
              <p className="auth-card__sub">
                Enter the invite your admin shared — the full link or just the code — and
                you’ll set up your account in the next step. Don’t have one yet? Ask your
                organization’s admin to add you; registration is invite-only.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const t = extractToken(pasted)
                  if (t) setParams({ token: t })
                }}
                noValidate
              >
                <div className="field">
                  <label htmlFor="su-invite">Invite link or code</label>
                  <div className="control">
                    <input
                      id="su-invite"
                      value={pasted}
                      onChange={(e) => setPasted(e.target.value)}
                      placeholder="Paste your invite link or code"
                    />
                  </div>
                </div>
                <button type="submit" className="btn-primary" disabled={!extractToken(pasted)}>
                  Continue
                </button>
              </form>
              <p className="auth-card__switch">
                Already registered? <Link to="/">Sign in</Link>
              </p>
            </>
          ) : lookupError ? (
            /* ---- Bad / expired token ---- */
            <>
              <span className="auth-card__badge">Invite only</span>
              <h2>That invite didn’t work</h2>
              <div className="auth-error" role="alert">
                <Icon name="alertTriangle" size={15} />
                {lookupError}
              </div>
              <p className="auth-card__sub">
                Invite links are single-use and expire after 7 days. Ask your admin to send you a
                fresh one from the People page.
              </p>
              <p className="auth-card__switch">
                Already registered? <Link to="/">Sign in</Link>
              </p>
            </>
          ) : !invite ? (
            /* ---- Looking the invite up ---- */
            <div className="route-loading" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span className="sr-only">Checking your invite…</span>
            </div>
          ) : (
            /* ---- Valid invite: complete the account ---- */
            <>
              <span className="auth-card__badge">You’re invited</span>
              <h2>Hi {invite.name.split(' ')[0]}, let’s finish your account</h2>
              <p className="auth-card__sub">
                You’re registering as <strong>{invite.email}</strong>
                {invite.designation ? ` · ${invite.designation}` : ''}
                {invite.department ? ` · ${invite.department}` : ''}
              </p>

              {submitError && (
                <div className="auth-error" role="alert">
                  <Icon name="alertTriangle" size={15} />
                  {submitError}
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate>
                <div className="field">
                  <label htmlFor="su-password">Create a password</label>
                  <div className="control">
                    <input
                      id="su-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder={`At least ${MIN_PASSWORD} characters`}
                      value={form.password}
                      onChange={(e) => update('password', e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                      aria-invalid={Boolean(showError('password'))}
                      required
                    />
                  </div>
                  {showError('password') && <p className="field-error">{errors.password}</p>}
                </div>

                <div className="field">
                  <label htmlFor="su-confirm">Confirm password</label>
                  <div className="control">
                    <input
                      id="su-confirm"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Type it again"
                      value={form.confirm}
                      onChange={(e) => update('confirm', e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
                      aria-invalid={Boolean(showError('confirm'))}
                      required
                    />
                  </div>
                  {showError('confirm') && <p className="field-error">{errors.confirm}</p>}
                </div>

                <div className="field">
                  <label htmlFor="su-phone">
                    Phone <span className="field-optional">(optional)</span>
                  </label>
                  <div className="control">
                    <input
                      id="su-phone"
                      type="tel"
                      autoComplete="tel"
                      placeholder="+91 98765 43210"
                      value={form.phone}
                      onChange={(e) => update('phone', e.target.value)}
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="su-dob">
                    Date of birth <span className="field-optional">(optional)</span>
                  </label>
                  <div className="control">
                    <input
                      id="su-dob"
                      type="date"
                      max={new Date().toISOString().slice(0, 10)}
                      value={form.dob}
                      onChange={(e) => update('dob', e.target.value)}
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="su-address">
                    Address <span className="field-optional">(optional)</span>
                  </label>
                  <div className="control">
                    <input
                      id="su-address"
                      autoComplete="street-address"
                      placeholder="City, State"
                      maxLength={300}
                      value={form.address}
                      onChange={(e) => update('address', e.target.value)}
                    />
                  </div>
                </div>

                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Creating your account…' : 'Create account & sign in'}
                </button>
              </form>
              <p className="auth-card__switch">
                You can add a photo and more details from your profile later.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
