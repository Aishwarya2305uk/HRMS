import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET, JWT_EXPIRES_IN, RECAPTCHA_SECRET_KEY } from '../env.js'
import { User } from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'
import { loginLimiter } from '../middleware/security.js'

const router = Router()

const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify'

/**
 * Verifies a reCAPTCHA v2 token with Google.
 *
 * Returns true when RECAPTCHA_SECRET_KEY isn't configured at all — same
 * "warn and skip" policy as bootstrapAdmin.js, so local/dev setups keep
 * working without every developer registering a site. Once a secret key IS
 * configured, this fails CLOSED: a missing token, a Google "not verified"
 * response, or even a network error talking to Google all reject the
 * login — a security gate that silently no-ops during an outage defeats
 * its own purpose.
 */
async function verifyCaptcha(token, remoteIp) {
  if (!RECAPTCHA_SECRET_KEY) {
    console.warn('[auth/login] RECAPTCHA_SECRET_KEY is not set — skipping CAPTCHA verification.')
    return true
  }
  if (!token) return false
  try {
    const params = new URLSearchParams({ secret: RECAPTCHA_SECRET_KEY, response: token })
    if (remoteIp) params.set('remoteip', remoteIp)
    // Bounded so a slow Google response can't eat the client's whole login
    // timeout — a stalled verification fails the login within 5s instead.
    const res = await fetch(RECAPTCHA_VERIFY_URL, {
      method: 'POST',
      body: params,
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    return data.success === true
  } catch (err) {
    console.error('[auth/login] reCAPTCHA verification request failed:', err)
    return false
  }
}

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  })
}

/**
 * POST /api/auth/login
 * Body: { email, password, captchaToken }
 * One login endpoint for every role — the frontend routes to the right
 * dashboard based on the role returned on `user`. CAPTCHA is checked before
 * touching the database at all, so a failed challenge never costs a bcrypt
 * comparison or reveals anything about whether the email exists.
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password, captchaToken } = req.body || {}
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' })
    }

    if (!(await verifyCaptcha(captchaToken, req.ip))) {
      return res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' })
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() })
    // Same generic message whether the email or password is wrong.
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    return res.json({ token: signToken(user), user: user.toSafeJSON() })
  } catch (err) {
    console.error('[auth/login]', err)
    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

/** GET /api/auth/me — resolve the current user from the token (session check). */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toSafeJSON() })
})

export default router
