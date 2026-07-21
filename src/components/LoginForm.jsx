import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * Reusable login card used by both the staff (/) and admin (/admin) portals.
 *
 * @param {object}  props
 * @param {'staff'|'admin'} props.portal
 * @param {string}  props.title
 * @param {string}  props.subtitle
 * @param {string}  props.badge
 */
export default function LoginForm({ portal, title, subtitle, badge }) {
  const { login, notice, clearNotice } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isAdmin = portal === 'admin'
  const redirectTo =
    location.state?.from?.pathname ?? (isAdmin ? '/admin/dashboard' : '/dashboard')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    clearNotice() // they're acting on it now — the explanation has done its job
    setSubmitting(true)

    // Read straight from the form fields so browser password-manager autofill
    // (which fills the DOM without firing React's onChange) is honored. Fall
    // back to controlled state for anything not in the form.
    const form = e.currentTarget
    const emailVal = (form.elements.email?.value ?? email).trim()
    const passwordVal = form.elements.password?.value ?? password

    // Keep controlled state in sync with what we actually submitted.
    setEmail(emailVal)
    setPassword(passwordVal)

    const result = await login(emailVal, passwordVal, portal)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    navigate(redirectTo, { replace: true })
  }

  return (
    <div className={`auth-card${isAdmin ? ' auth-card--admin' : ''}`}>
      <span className={`auth-card__badge${isAdmin ? ' is-admin' : ''}`}>
        {isAdmin ? '🔒' : '👋'} {badge}
      </span>

      <h2>{title}</h2>
      <p className="auth-card__sub">{subtitle}</p>

      {/* Explains why they were bounced back here (expired session), so the
          login screen doesn't feel like it appeared at random. */}
      {notice && !error && (
        <div className="auth-notice" role="status">
          <span aria-hidden="true">🔒</span>
          {notice}
        </div>
      )}

      {error && (
        <div className="auth-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="email">Work email</label>
          <div className="control">
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@trula.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <div className="control">
            <input
              id="password"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="toggle-pw"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <div className="auth-row">
          <label>
            <input type="checkbox" /> Remember me
          </label>
          <a href="#reset" onClick={(e) => e.preventDefault()}>
            Forgot password?
          </a>
        </div>

        <button
          type="submit"
          className={`btn-primary${isAdmin ? ' is-admin' : ''}`}
          disabled={submitting}
        >
          {submitting ? 'Signing in…' : isAdmin ? 'Enter admin console' : 'Sign in'}
        </button>
      </form>

      <p className="auth-foot">
        {isAdmin ? (
          <>Not an admin? <a href="/">Go to staff sign in</a></>
        ) : (
          <>Administrator? <a href="/admin">Admin sign in</a></>
        )}
      </p>
    </div>
  )
}
