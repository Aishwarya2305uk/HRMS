import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Load env from project root. Precedence (highest first): existing shell env,
// then .env.local, then .env. dotenv never overrides an already-set var, so
// loading .env.local before .env gives it priority over .env.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: resolve(root, '.env.local') })
dotenv.config({ path: resolve(root, '.env') })

// dotenv keeps surrounding quotes off but tolerates `KEY = value` spacing.
export const DATABASE_URL = process.env.DATABASE_URL?.trim()

// In production a missing/weak JWT_SECRET is fatal: anyone who reads the
// public dev fallback below could forge a valid token for any account, so
// refusing to start is strictly safer than starting insecurely.
const isProduction = process.env.NODE_ENV === 'production'
const configuredJwtSecret = process.env.JWT_SECRET?.trim()
if (isProduction && (!configuredJwtSecret || configuredJwtSecret.length < 32)) {
  throw new Error(
    'JWT_SECRET must be set to at least 32 characters in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
  )
}
export const JWT_SECRET = configuredJwtSecret || 'dev-only-insecure-secret-change-me'
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN?.trim() || '7d'
export const PORT = Number(process.env.PORT) || 4000

// Bootstraps exactly one admin account on first DB connect (see
// bootstrapAdmin.js). That admin then adds every other employee/manager
// through the People screen — the app never ships or seeds demo accounts.
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase()
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim()
export const ADMIN_NAME = process.env.ADMIN_NAME?.trim() || 'Administrator'

// Server-side Cloudflare Turnstile secret (never exposed to the client — the
// public site key lives in the frontend build as VITE_TURNSTILE_SITE_KEY
// instead). Optional: if unset, login skips CAPTCHA verification entirely
// (see routes/auth.js) rather than locking everyone out — same "warn and skip
// if unconfigured" policy as the admin bootstrap above.
export const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY?.trim()

// Comma-separated list of browser origins allowed to call the API cross-
// origin (e.g. the Vercel frontend URL). Empty means "allow all" — fine for
// local dev, but production should always set it (see middleware/security.js).
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)
