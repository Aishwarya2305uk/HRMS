import { q } from './db.js'
import { hashPassword, nextEmployeeId } from './store.js'
import { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } from './env.js'
import { passwordPolicyError } from './utils/password.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Creates the single initial admin account from ADMIN_EMAIL/ADMIN_PASSWORD
 * env vars, if an account with that email doesn't already exist. This is the
 * ONLY account the app ever creates on its own — every other employee or
 * manager is added afterwards by that admin, through the People screen,
 * which is what wires them into the org tree.
 *
 * Called once per process from connectDB() so it applies automatically when
 * the server boots — no manual seed step needed on a fresh deploy.
 *
 * Never overwrites an existing admin: the env vars bootstrap the account
 * once, they are not a standing password-reset switch. To rotate the admin
 * password, sign in and change it (or update the row directly).
 */
export async function bootstrapAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn(
      '[bootstrap] ADMIN_EMAIL / ADMIN_PASSWORD are not set — no admin account will be created. ' +
        'Add them to your environment (see .env.example) and restart.',
    )
    return
  }
  if (!EMAIL_RE.test(ADMIN_EMAIL)) {
    console.error('[bootstrap] ADMIN_EMAIL is not a valid email address — skipping admin creation.')
    return
  }
  const passwordError = passwordPolicyError(ADMIN_PASSWORD)
  if (passwordError) {
    console.error(`[bootstrap] ADMIN_PASSWORD rejected: ${passwordError} Skipping admin creation.`)
    return
  }

  const { rows: existing } = await q('select id from users where email = $1', [ADMIN_EMAIL])
  if (existing.length) return

  // The admin already gets a leave balance and can already apply for leave
  // today (no role gate on POST /leaves) — assign a default employment type
  // so that keeps working instead of silently landing on a zeroed policy.
  const { rows: fullTimeRows } = await q(
    "select id, quotas from employment_types where name = 'Full-time' limit 1",
  )
  const fullTime = fullTimeRows[0] ?? null
  const quotas = fullTime?.quotas || {}

  // Two cold starts can both see "no admin yet" and race to create one —
  // on conflict do nothing lets the loser lose quietly: the account exists
  // either way.
  const { rowCount } = await q(
    `insert into users (name, email, employee_id, password_hash, role, employment_type_id,
                        leave_quotas, leave_balances)
     values ($1, $2, $3, $4, 'admin', $5, $6, $6)
     on conflict (email) do nothing`,
    [
      ADMIN_NAME,
      ADMIN_EMAIL,
      await nextEmployeeId(),
      await hashPassword(ADMIN_PASSWORD),
      fullTime?.id ?? null,
      JSON.stringify(quotas),
    ],
  )
  if (rowCount) console.log(`[bootstrap] created initial admin account: ${ADMIN_EMAIL}`)
}
