/**
 * One shared password policy for every place an account password is set —
 * the admin bootstrap (bootstrapAdmin.js) and admin-created employees
 * (routes/employees.js) — so the rules can never drift apart. Future
 * password-change/reset flows should call this too.
 */
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

/**
 * Returns a user-facing error string when the password breaks policy,
 * or null when it's acceptable.
 */
export function passwordPolicyError(password) {
  const value = String(password ?? '')
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`
  }
  return null
}
