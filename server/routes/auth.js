import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET, JWT_EXPIRES_IN, TURNSTILE_SECRET_KEY } from '../env.js'
import { q } from '../db.js'
import {
  findUserByEmail,
  comparePassword,
  safeUserJSON,
  hashPassword,
  findPendingInviteByToken,
  mapUser,
} from '../store.js'
import { requireAuth } from '../middleware/auth.js'
import { loginLimiter, inviteLimiter } from '../middleware/security.js'
import { passwordPolicyError } from '../utils/password.js'

const router = Router()

const PHONE_RE = /^[0-9+\-\s()]{7,20}$/

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * Verifies a Cloudflare Turnstile token (replaced Google reCAPTCHA, whose
 * verification kept failing on the live deployment).
 *
 * Returns true when TURNSTILE_SECRET_KEY isn't configured at all — same
 * "warn and skip" policy as bootstrapAdmin.js, so local/dev setups keep
 * working without every developer registering a site. Once a secret key IS
 * configured, this fails CLOSED: a missing token, a Cloudflare "not verified"
 * response, or even a network error talking to Cloudflare all reject the
 * login — a security gate that silently no-ops during an outage defeats
 * its own purpose.
 */
async function verifyCaptcha(token, remoteIp) {
  if (!TURNSTILE_SECRET_KEY) {
    console.warn('[auth/login] TURNSTILE_SECRET_KEY is not set — skipping CAPTCHA verification.')
    return true
  }
  if (!token) return false
  try {
    const params = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token })
    if (remoteIp) params.set('remoteip', remoteIp)
    // Bounded so a slow Cloudflare response can't eat the client's whole login
    // timeout — a stalled verification fails the login within 5s instead.
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: params,
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    if (data.success !== true) {
      // error-codes make misconfiguration (wrong secret, hostname mismatch)
      // diagnosable from the server logs instead of a generic login failure.
      console.warn('[auth/login] Turnstile rejected the token:', data['error-codes'] ?? [])
      return false
    }
    return true
  } catch (err) {
    console.error('[auth/login] Turnstile verification request failed:', err)
    return false
  }
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, {
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

    const user = await findUserByEmail(email)
    // A pending invite has no password to check — tell the person what to do
    // instead of a dead-end "invalid password". (Deliberate, narrow exception
    // to the no-enumeration rule below: it only fires for the exact invited
    // email, behind the CAPTCHA and rate limit.)
    if (user && (user.status === 'invited' || !user.passwordHash)) {
      return res.status(403).json({
        error:
          'This account hasn’t been set up yet — open the invite link from your admin to create your password first.',
      })
    }
    // Same generic message whether the email or password is wrong.
    if (!user || !(await comparePassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    return res.json({ token: signToken(user), user: safeUserJSON(user) })
  } catch (err) {
    console.error('[auth/login]', err)
    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

/** GET /api/auth/me — resolve the current user from the token (session check). */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: safeUserJSON(req.user) })
})

/**
 * GET /api/auth/invite?token=... — public: resolve an invite link to the
 * pending account it belongs to, so the sign-up page can greet the person
 * and lock the email field. Returns only display fields, never ids or org
 * data. Invalid, expired or already-used tokens all get the same 404.
 */
router.get('/invite', inviteLimiter, async (req, res, next) => {
  try {
    const user = await findPendingInviteByToken(req.query.token)
    if (!user) {
      return res.status(404).json({
        error: 'This invite link is invalid or has expired — ask your admin for a new one.',
      })
    }
    res.json({
      name: user.name,
      email: user.email,
      designation: user.designation || '',
      department: user.department || '',
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/auth/register — public: an INVITED person completes their
 * account. Body: { token, password, phone?, dob?, address? }
 * Only a valid, unexpired invite token can register — there is no open
 * sign-up. Sets the password, fills any optional personal details, flips
 * status to 'active' and burns the token (single-use), then signs the person
 * straight in.
 */
router.post('/register', inviteLimiter, async (req, res, next) => {
  try {
    const { token, password, phone, dob, address } = req.body || {}

    const user = await findPendingInviteByToken(token)
    if (!user) {
      return res.status(404).json({
        error: 'This invite link is invalid or has expired — ask your admin for a new one.',
      })
    }

    const passwordError = passwordPolicyError(password)
    if (passwordError) return res.status(400).json({ error: passwordError })

    // Optional personal details — same rules as the profile editor
    // (routes/employees.js); everything else stays admin-managed.
    const details = { phone: null, dob: null, address: null }
    if (phone !== undefined && String(phone).trim()) {
      const trimmed = String(phone).trim()
      if (!PHONE_RE.test(trimmed)) return res.status(400).json({ error: 'Enter a valid phone number.' })
      details.phone = trimmed
    }
    if (dob !== undefined && dob) {
      const parsed = new Date(dob)
      if (Number.isNaN(parsed.getTime()) || parsed > new Date()) {
        return res.status(400).json({ error: 'Enter a valid date of birth.' })
      }
      details.dob = parsed
    }
    if (address !== undefined && String(address).trim()) {
      const trimmed = String(address).trim()
      if (trimmed.length > 300) return res.status(400).json({ error: 'Address must be under 300 characters.' })
      details.address = trimmed
    }

    // The status guard in the WHERE clause makes activation single-shot even
    // if two registrations race on the same token.
    const { rows } = await q(
      `update users
          set password_hash = $1, status = 'active', invite_token_hash = null,
              invite_expires_at = null,
              phone = coalesce($2, phone),
              dob = coalesce($3, dob),
              address = coalesce($4, address)
        where id = $5 and status = 'invited'
        returning *`,
      [await hashPassword(String(password)), details.phone, details.dob, details.address, user.id],
    )
    if (!rows.length) {
      return res.status(409).json({ error: 'This invite was already used — try signing in instead.' })
    }

    const activated = mapUser(rows[0])
    res.status(201).json({ token: signToken(activated), user: safeUserJSON(activated) })
  } catch (err) {
    next(err)
  }
})

export default router
