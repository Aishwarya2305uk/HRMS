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
export const MONGODB_URL = process.env.MONGODB_URL?.trim()
export const JWT_SECRET =
  process.env.JWT_SECRET?.trim() || 'dev-only-insecure-secret-change-me'
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN?.trim() || '7d'
export const PORT = Number(process.env.PORT) || 4000
