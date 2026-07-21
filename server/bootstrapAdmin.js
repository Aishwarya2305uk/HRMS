import { User } from './models/User.js'
import { defaultLeaveBalances } from './config.js'
import { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } from './env.js'

const MIN_PASSWORD = 8
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Creates the single initial admin account from ADMIN_EMAIL/ADMIN_PASSWORD
 * env vars, if an account with that email doesn't already exist. This is the
 * ONLY account the app ever creates on its own — every other employee or
 * manager is added afterwards by that admin, through the People screen,
 * which is what wires them into the org tree.
 *
 * Called once per process from connectDB() so it applies automatically on
 * both the standalone server and the Vercel serverless function — no manual
 * seed step needed on a fresh deploy.
 *
 * Never overwrites an existing admin: the env vars bootstrap the account
 * once, they are not a standing password-reset switch. To rotate the admin
 * password, sign in and change it (or update the document directly).
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
  if (ADMIN_PASSWORD.length < MIN_PASSWORD) {
    console.error(
      `[bootstrap] ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters — skipping admin creation.`,
    )
    return
  }

  const existing = await User.findOne({ email: ADMIN_EMAIL })
  if (existing) return

  const admin = new User({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    role: 'admin',
    leaveBalances: defaultLeaveBalances(),
  })
  await admin.setPassword(ADMIN_PASSWORD)
  try {
    await admin.save()
    console.log(`[bootstrap] created initial admin account: ${ADMIN_EMAIL}`)
  } catch (err) {
    // Two cold starts can both see "no admin yet" and race to create one —
    // the unique email index rejects the loser. That's fine, not a failure:
    // the account exists either way. Anything else should still surface.
    if (err?.code !== 11000) throw err
  }
}
