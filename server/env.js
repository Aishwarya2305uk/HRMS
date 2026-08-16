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

// Outbound mail (invite emails) via SMTP — see services/mailer.js. Optional:
// with SMTP_HOST/SMTP_USER/SMTP_PASS unset the server warns once and skips
// sending (the admin still gets the invite link to share by hand), same
// "warn and skip if unconfigured" policy as Turnstile above.
export const SMTP_HOST = process.env.SMTP_HOST?.trim()
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 465
export const SMTP_USER = process.env.SMTP_USER?.trim()
export const SMTP_PASS = process.env.SMTP_PASS
export const SMTP_FROM = process.env.SMTP_FROM?.trim() || SMTP_USER

// Attendance check-in geolocation: the IP a check-in arrives from is always
// recorded; turning this on also resolves that IP to a coarse city/country
// through a public lookup service (see services/geoip.js). Optional and
// fail-soft — an unreachable/rate-limited provider just leaves the location
// blank, same "warn and skip if unconfigured" policy as Turnstile and SMTP.
// GEOIP_URL must contain the {ip} placeholder; the default is ip-api.com's
// free endpoint (no key, ~45 lookups/minute).
export const GEOIP_ENABLED = (process.env.GEOIP_ENABLED ?? 'true').trim().toLowerCase() !== 'false'
export const GEOIP_URL =
  process.env.GEOIP_URL?.trim() ||
  'http://ip-api.com/json/{ip}?fields=status,country,countryCode,regionName,city'

// Public URL of the frontend, used to build invite links inside emails
// (e.g. https://your-app.vercel.app). Falls back to the request's Origin
// header, so local dev works without setting it.
export const APP_URL = process.env.APP_URL?.trim().replace(/\/+$/, '')
