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
  findUserByResetToken,
  newInviteToken,
  hashInviteToken,
  RESET_TTL_MS,
  mapUser,
} from '../store.js'
import { requireAuth } from '../middleware/auth.js'
import { resolveLeaveBalances } from '../services/leavePolicy.js'
import { recordActivity } from '../services/activityLog.js'
import { loginLimiter, inviteLimiter, forgotLimiter } from '../middleware/security.js'
import { passwordPolicyError } from '../utils/password.js'
import { sendPasswordResetEmail, appOrigin } from '../services/mailer.js'

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
    return 'ok'
  }
  // No token at all is a DIFFERENT failure from Cloudflare saying no, and
  // conflating them sent us hunting a broken CAPTCHA when the real answer was
  // "the widget hadn't finished yet". It also catches the nastiest
  // misconfiguration: a frontend built WITHOUT VITE_TURNSTILE_SITE_KEY renders
  // no widget and posts no token, so every login here fails forever while the
  // login page looks perfectly normal.
  if (!token) {
    console.warn(
      '[auth/login] no CAPTCHA token in the request. If the sign-in page shows no ' +
        'Turnstile widget at all, the FRONTEND was built without VITE_TURNSTILE_SITE_KEY ' +
        'while this server has TURNSTILE_SECRET_KEY set — set both, or neither.',
    )
    return 'missing'
  }
  const params = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token })
  if (remoteIp) params.set('remoteip', remoteIp)
  // Two attempts: one flaky-network timeout shouldn't fail a login. Only
  // NETWORK errors retry — a "not verified" answer from Cloudflare is final —
  // and persistent unreachability still fails closed after the second try.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // Bounded so a slow Cloudflare response can't eat the client's whole
      // login timeout — each attempt gets 6s, worst case 12s total.
      const res = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        body: params,
        signal: AbortSignal.timeout(6000),
      })
      const data = await res.json()
      if (data.success !== true) {
        // error-codes make misconfiguration (wrong secret, hostname mismatch)
        // diagnosable from the server logs instead of a generic login failure.
        const codes = data['error-codes'] ?? []
        console.warn('[auth/login] Turnstile rejected the token:', codes)
        // A spent or expired token is the user's page being stale, not a
        // failed challenge — worth its own message so they reload instead of
        // retrying the same dead token.
        if (codes.includes('timeout-or-duplicate')) return 'stale'
        // These two mean the KEYS are wrong, which no amount of retrying will
        // fix — every login fails forever until someone changes an env var:
        //   invalid-input-secret   — TURNSTILE_SECRET_KEY isn't a valid secret
        //   invalid-input-response — the token doesn't belong to this secret,
        //     i.e. the frontend's site key and this secret are from different
        //     widgets (the classic case: a TEST site key in the frontend build
        //     against a REAL secret here, or vice versa).
        if (codes.includes('invalid-input-secret') || codes.includes('invalid-input-response')) {
          console.error(
            '[auth/login] Turnstile KEY MISMATCH — TURNSTILE_SECRET_KEY does not pair with the ' +
              "site key this frontend was built with. Both must come from the SAME Cloudflare " +
              'widget (or both be the matching test pair 1x…AA / 1x…AA). Logins cannot succeed ' +
              'until this is fixed.',
          )
          return 'misconfigured'
        }
        return 'rejected'
      }
      return 'ok'
    } catch (err) {
      console.error(`[auth/login] Turnstile verify attempt ${attempt} failed:`, err.message)
    }
  }
  return 'unreachable'
}

/** User-facing copy per verifyCaptcha outcome — each one names a next step. */
const CAPTCHA_ERRORS = {
  missing: 'The human-verification check hasn’t finished. Wait for it to complete, then sign in.',
  stale: 'That verification had already been used. Please reload the page and sign in again.',
  // Deliberately does NOT say "try again": retrying is futile, and telling
  // someone to retry a server misconfiguration wastes their time and hides
  // the outage. No key material or internals in the copy — the detail is in
  // the server log for whoever can act on it.
  misconfigured:
    'Sign-in verification isn’t configured correctly on this site. Please contact your administrator.',
  rejected: 'CAPTCHA verification failed. Please try again.',
  unreachable: "We couldn't reach the verification service. Please try again in a moment.",
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

    const captcha = await verifyCaptcha(captchaToken, req.ip)
    if (captcha !== 'ok') {
      return res.status(400).json({ error: CAPTCHA_ERRORS[captcha] ?? CAPTCHA_ERRORS.rejected })
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
      // Recorded even though the response stays deliberately vague: a run of
      // failed sign-ins against one address is exactly what an admin reviewing
      // the audit trail needs to see. The entry names only the address that
      // was TRIED, which the person at the keyboard already typed.
      recordActivity(req, 'auth.login_failed', {
        status: 'failed',
        actor: user ? { id: user.id, name: user.name, email: user.email, role: user.role } : { name: String(email).trim().slice(0, 160) },
        targetType: 'account',
        targetName: String(email).trim().slice(0, 200),
        description: `Failed sign-in attempt for ${String(email).trim()}.`,
      })
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    // Balances the client shows must be the EFFECTIVE ones — day/month-period
    // leave types compute their remaining per period rather than storing it.
    await resolveLeaveBalances(user)
    recordActivity(req, 'auth.login', {
      actor: user,
      description: `${user.name} signed in.`,
    })
    return res.json({ token: signToken(user), user: safeUserJSON(user) })
  } catch (err) {
    console.error('[auth/login]', err)
    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

/**
 * POST /api/auth/logout — records the sign-out in the activity trail.
 *
 * Sessions are stateless JWTs, so there is nothing to invalidate server-side;
 * the client drops the token either way and this endpoint failing must never
 * keep someone signed in. It exists purely so "signed out" appears in the
 * audit trail next to "signed in" — without it the trail shows people arriving
 * and never leaving.
 */
router.post('/logout', requireAuth, (req, res) => {
  recordActivity(req, 'auth.logout', { description: `${req.user.name} signed out.` })
  res.json({ ok: true })
})

/** GET /api/auth/me — resolve the current user from the token (session check). */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    await resolveLeaveBalances(req.user)
    res.json({ user: safeUserJSON(req.user) })
  } catch (err) {
    next(err)
  }
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
    await resolveLeaveBalances(activated)
    recordActivity(req, 'auth.registered', {
      actor: activated,
      targetType: 'employee',
      targetId: activated.id,
      targetName: activated.name,
      description: `${activated.name} activated their account from an invite link.`,
    })
    res.status(201).json({ token: signToken(activated), user: safeUserJSON(activated) })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/auth/forgot — public: request a password-reset email.
 * Body: { email }
 * ALWAYS answers the same 200, whether the email matched an account, matched
 * a pending invite, or matched nothing — the response must not be an account-
 * enumeration oracle. All the real work (mint token, store hash, send email)
 * happens only for an active account, and even an SMTP failure doesn't change
 * the response, just the server log. forgotLimiter caps the outbound mail.
 */
router.post('/forgot', forgotLimiter, async (req, res, next) => {
  try {
    const { email } = req.body || {}
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required.' })
    }

    const user = await findUserByEmail(email)
    // Invited accounts have no password to reset — their path is the invite
    // link. Silently skip (same response) rather than hint the email exists.
    if (user && user.status === 'active' && user.passwordHash) {
      // Reuses the invite token scheme: 256-bit raw token in the link only,
      // SHA-256 hash at rest. A new request overwrites any previous token,
      // so only the latest emailed link works.
      const reset = newInviteToken()
      await q('update users set reset_token_hash = $1, reset_expires_at = $2 where id = $3', [
        reset.tokenHash,
        new Date(Date.now() + RESET_TTL_MS),
        user.id,
      ])
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl: `${appOrigin(req)}/reset-password?token=${encodeURIComponent(reset.token)}`,
      })
      // Inside the `if`, so the trail can't be used as the enumeration oracle
      // the response itself is so careful not to be: no row is written for an
      // address that doesn't belong to an active account.
      recordActivity(req, 'auth.password_reset_requested', {
        actor: user,
        description: `${user.name} requested a password reset link.`,
      })
    }

    res.json({
      message: 'If that email belongs to an account, a reset link is on its way. Check your inbox.',
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/auth/reset?token=... — public: resolve a reset link so the page
 * can greet the person before they type a new password. Mirrors GET /invite:
 * display fields only, one shared 404 for invalid/expired/used tokens.
 */
router.get('/reset', inviteLimiter, async (req, res, next) => {
  try {
    const user = await findUserByResetToken(req.query.token)
    if (!user) {
      return res.status(404).json({
        error: 'This reset link is invalid or has expired — request a new one from the sign-in page.',
      })
    }
    res.json({ name: user.name, email: user.email })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/auth/reset — public: set a new password using a reset token.
 * Body: { token, password }
 * Burns the token (single-use, enforced by the WHERE clause even under a
 * race) and signs the person straight in, like /register does.
 */
router.post('/reset', inviteLimiter, async (req, res, next) => {
  try {
    const { token, password } = req.body || {}

    const user = await findUserByResetToken(token)
    if (!user) {
      return res.status(404).json({
        error: 'This reset link is invalid or has expired — request a new one from the sign-in page.',
      })
    }

    const passwordError = passwordPolicyError(password)
    if (passwordError) return res.status(400).json({ error: passwordError })

    const { rows } = await q(
      `update users
          set password_hash = $1, reset_token_hash = null, reset_expires_at = null
        where id = $2 and reset_token_hash = $3
        returning *`,
      [await hashPassword(String(password)), user.id, hashInviteToken(token)],
    )
    if (!rows.length) {
      return res.status(409).json({ error: 'This reset link was already used — request a new one.' })
    }

    const updated = mapUser(rows[0])
    await resolveLeaveBalances(updated)
    recordActivity(req, 'auth.password_reset', {
      actor: updated,
      description: `${updated.name} set a new password using a reset link.`,
    })
    res.json({ token: signToken(updated), user: safeUserJSON(updated) })
  } catch (err) {
    next(err)
  }
})

export default router
