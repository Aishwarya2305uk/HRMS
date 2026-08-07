import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { CORS_ORIGINS } from '../env.js'

/**
 * One place for every request-hardening middleware (headers, CORS, rate
 * limits), mirroring how middleware/auth.js owns authentication. Routes only
 * import from here, so policy changes never require touching route files.
 */

/** Defensive HTTP headers. Helmet's defaults suit a JSON-only API. */
export const securityHeaders = helmet()

const allowedOrigins = new Set(CORS_ORIGINS)
if (allowedOrigins.size === 0) {
  // Same "warn and skip if unconfigured" policy as the admin bootstrap and
  // the Turnstile CAPTCHA: local/dev setups keep working without extra config, but
  // production should always set CORS_ORIGINS (see .env.example).
  console.warn('[security] CORS_ORIGINS is not set — allowing all origins (dev only).')
}

/**
 * Restricts browser cross-origin calls to the configured frontend origins.
 * Requests with no Origin header (same-origin, curl, the Vercel /api proxy,
 * cron) are always allowed — CORS only governs browsers on OTHER origins.
 */
export const corsPolicy = cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.size === 0 || allowedOrigins.has(origin)) {
      return callback(null, true)
    }
    return callback(Object.assign(new Error('This origin is not allowed.'), { status: 403 }))
  },
})

/**
 * Login brute-force / credential-stuffing brake: 10 FAILED attempts per IP
 * per 15 minutes (successful logins don't count against the limit). The
 * response shape matches every other API error so apiFetch surfaces the
 * message as-is.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
})

/**
 * Brake on the public invite endpoints (lookup + register) so invite tokens
 * can't be brute-forced. Tokens are 256-bit so guessing is hopeless anyway —
 * this just keeps the attempt noise down. Looser than login because a legit
 * user may reload the sign-up page several times while filling it in.
 */
export const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
})
