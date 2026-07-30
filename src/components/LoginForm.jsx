import { useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from './Icon'
import Recaptcha from './Recaptcha'

/** Login card used by the single sign-in page, shared by every role. */
const ROLE_HOME = { admin: '/admin/dashboard' }

// Mirrors the backend's "unconfigured -> skip" policy (see
// server/routes/auth.js's verifyCaptcha): with no site key built in, the
// widget never renders and the form never blocks on it.
const REQUIRE_CAPTCHA = Boolean(import.meta.env.VITE_RECAPTCHA_SITE_KEY)

export default function LoginForm() {
  const { login, notice, clearNotice } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const captchaRef = useRef(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [captchaToken, setCaptchaToken] = useState(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    clearNotice() // they're acting on it now — the explanation has done its job

    if (REQUIRE_CAPTCHA && !captchaToken) {
      setError('Please complete the CAPTCHA verification.')
      return
    }

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

    const result = await login(emailVal, passwordVal, captchaToken)
    setSubmitting(false)

    if (!result.ok) {
      // A reCAPTCHA token is single-use — whatever failed, the widget needs
      // to be completed again before the next attempt.
      captchaRef.current?.reset()
      setCaptchaToken(null)
      setError(result.error)
      return
    }
    const home = ROLE_HOME[result.user.role] ?? '/dashboard'
    navigate(location.state?.from?.pathname ?? home, { replace: true })
  }

  return (
    <div className="auth-card">
      <span className="auth-card__badge">Welcome back</span>

      <h2>Sign in to Trula</h2>
      <p className="auth-card__sub">
        Use your work email to access your dashboard, leaves and team.
      </p>

      {/* Explains why they were bounced back here (expired session), so the
          login screen doesn't feel like it appeared at random. */}
      {notice && !error && (
        <div className="auth-notice" role="status">
          {notice}
        </div>
      )}

      {error && (
        <div className="auth-error" role="alert">
          <Icon name="alertTriangle" size={15} />
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

        {REQUIRE_CAPTCHA && (
          <Recaptcha ref={captchaRef} onChange={setCaptchaToken} onError={setError} />
        )}

        <button
          type="submit"
          className="btn-primary"
          disabled={submitting || (REQUIRE_CAPTCHA && !captchaToken)}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
