import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { passwordReset } from '../lib/hrms'
import Icon from '../components/Icon'
import './Auth.css'

const MIN_PASSWORD = 8
const ROLE_HOME = { admin: '/admin/dashboard' }

/**
 * Self-service password reset at /reset-password, modeled on SignUp.jsx.
 * Two modes, split on ?token:
 *   - No token: ask for the account email and request the reset link. The
 *     confirmation is the same whether or not the email matched an account —
 *     the backend keeps that secret on purpose (no enumeration).
 *   - With token (from the emailed link): resolve it to the account, take a
 *     new password, and sign the person straight in — same flow as
 *     completing an invite.
 */
export default function ResetPassword() {
  const { adoptSession } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''

  // Request mode.
  const [email, setEmail] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [requested, setRequested] = useState('') // confirmation message once sent
  const [requestError, setRequestError] = useState('')

  // Reset mode: null = loading, {error} handled via lookupError, {name,email} = ok.
  const [account, setAccount] = useState(null)
  const [lookupError, setLookupError] = useState('')

  const [form, setForm] = useState({ password: '', confirm: '' })
  const [touched, setTouched] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    let active = true
    setAccount(null)
    setLookupError('')
    passwordReset
      .lookup(token)
      .then((data) => active && setAccount(data))
      .catch((err) => active && setLookupError(err.message))
    return () => {
      active = false
    }
  }, [token])

  const errors = useMemo(() => {
    const e = {}
    if (!form.password) e.password = 'Create a new password.'
    else if (form.password.length < MIN_PASSWORD) {
      e.password = `Use at least ${MIN_PASSWORD} characters.`
    }
    if (form.confirm !== form.password) e.confirm = 'Passwords don’t match.'
    return e
  }, [form])

  const isValid = Object.keys(errors).length === 0
  const showError = (f) => (touched[f] || touched._submitted) && errors[f]

  async function handleRequest(e) {
    e.preventDefault()
    setRequestError('')
    if (!email.trim()) return
    setRequesting(true)
    try {
      const { message } = await passwordReset.request(email.trim())
      setRequested(message)
    } catch (err) {
      setRequestError(err.message)
    } finally {
      setRequesting(false)
    }
  }

  async function handleReset(e) {
    e.preventDefault()
    setSubmitError('')
    setTouched((t) => ({ ...t, _submitted: true }))
    if (!isValid) {
      document.getElementById(errors.password ? 'rp-password' : 'rp-confirm')?.focus()
      return
    }
    setSubmitting(true)
    try {
      const { token: jwt, user } = await passwordReset.reset({ token, password: form.password })
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
          <h1>Locked out?</h1>
          <p>It happens. Set a new password and get back to your workspace.</p>
        </div>

        <blockquote className="brand__quote">
          <p>&ldquo;Alone we can do so little; together we can do so much.&rdquo;</p>
          <cite>Helen Keller</cite>
        </blockquote>
      </aside>

      {/* Right: the reset card. */}
      <main className="auth__panel">
        <div className="auth-card">
          {!token ? (
            requested ? (
              /* ---- Link requested: tell them to check their inbox ---- */
              <>
                <span className="auth-card__badge">Check your email</span>
                <h2>Reset link sent</h2>
                <p className="auth-card__sub">{requested}</p>
                <p className="auth-card__sub">
                  The link expires in 1 hour. Nothing arriving? Check spam, make sure you used
                  your work email, or try again.
                </p>
                <p className="auth-card__switch">
                  Remembered it after all? <Link to="/">Sign in</Link>
                </p>
              </>
            ) : (
              /* ---- Request a reset link ---- */
              <>
                <span className="auth-card__badge">Reset password</span>
                <h2>Forgot your password?</h2>
                <p className="auth-card__sub">
                  Enter your work email and we’ll send you a link to set a new one.
                </p>

                {requestError && (
                  <div className="auth-error" role="alert">
                    <Icon name="alertTriangle" size={15} />
                    {requestError}
                  </div>
                )}

                <form onSubmit={handleRequest} noValidate>
                  <div className="field">
                    <label htmlFor="rp-email">Work email</label>
                    <div className="control">
                      <input
                        id="rp-email"
                        type="email"
                        autoComplete="username"
                        placeholder="you@trula.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <button type="submit" className="btn-primary" disabled={requesting || !email.trim()}>
                    {requesting ? 'Sending…' : 'Email me a reset link'}
                  </button>
                </form>
                <p className="auth-card__switch">
                  Remembered it? <Link to="/">Sign in</Link>
                </p>
              </>
            )
          ) : lookupError ? (
            /* ---- Bad / expired / used token ---- */
            <>
              <span className="auth-card__badge">Reset password</span>
              <h2>That link didn’t work</h2>
              <div className="auth-error" role="alert">
                <Icon name="alertTriangle" size={15} />
                {lookupError}
              </div>
              <p className="auth-card__sub">
                Reset links are single-use and expire after 1 hour.{' '}
                <Link to="/reset-password">Request a new one</Link> and use the freshest email.
              </p>
              <p className="auth-card__switch">
                Remembered it after all? <Link to="/">Sign in</Link>
              </p>
            </>
          ) : !account ? (
            /* ---- Looking the token up ---- */
            <div className="route-loading" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span className="sr-only">Checking your reset link…</span>
            </div>
          ) : (
            /* ---- Valid link: set the new password ---- */
            <>
              <span className="auth-card__badge">Almost there</span>
              <h2>Hi {account.name.split(' ')[0]}, choose a new password</h2>
              <p className="auth-card__sub">
                Setting a new password for <strong>{account.email}</strong>
              </p>

              {submitError && (
                <div className="auth-error" role="alert">
                  <Icon name="alertTriangle" size={15} />
                  {submitError}
                </div>
              )}

              <form onSubmit={handleReset} noValidate>
                <div className="field">
                  <label htmlFor="rp-password">New password</label>
                  <div className="control">
                    <input
                      id="rp-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder={`At least ${MIN_PASSWORD} characters`}
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                      aria-invalid={Boolean(showError('password'))}
                      required
                    />
                  </div>
                  {showError('password') && <p className="field-error">{errors.password}</p>}
                </div>

                <div className="field">
                  <label htmlFor="rp-confirm">Confirm password</label>
                  <div className="control">
                    <input
                      id="rp-confirm"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Type it again"
                      value={form.confirm}
                      onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
                      onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
                      aria-invalid={Boolean(showError('confirm'))}
                      required
                    />
                  </div>
                  {showError('confirm') && <p className="field-error">{errors.confirm}</p>}
                </div>

                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Updating your password…' : 'Set new password & sign in'}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
