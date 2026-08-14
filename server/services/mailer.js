/**
 * Outbound email via SMTP (nodemailer). One concern: sending the invite
 * link to a newly added (or re-invited) person so onboarding doesn't depend
 * on the admin pasting the link into chat.
 *
 * Configuration is optional — with SMTP unset the server logs one warning at
 * startup and sendInviteEmail() resolves false, so the People flow degrades
 * to exactly what it was before: the admin copies the link from the modal.
 * Email failures are likewise reported, never thrown: an unreachable SMTP
 * host must not roll back an otherwise-successful invite.
 */
import nodemailer from 'nodemailer'
import { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, APP_URL, CORS_ORIGINS } from '../env.js'

export const mailerConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS)

const transporter = mailerConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465 is implicit TLS; 587/25 upgrade via STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      // Fail fast when the SMTP host is unreachable. Some hosts (e.g. Render's
      // free tier) silently drop outbound SMTP traffic, and nodemailer's
      // default 2-minute connection timeout would hold the invite response
      // long past the frontend's 15s abort (src/lib/api.js) — the send must
      // lose quickly so the admin gets the copyable-link fallback instead of
      // a "took too long" error.
      connectionTimeout: 7000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    })
  : null

if (!mailerConfigured) {
  console.warn('[mailer] SMTP not configured — invite emails will be skipped (set SMTP_HOST/SMTP_USER/SMTP_PASS).')
}

/**
 * Where invite links should point. APP_URL wins when set (production, where
 * the API and frontend live on different hosts); otherwise the request's
 * Origin header — the browser sets it to the frontend's own origin, the same
 * value the People modal uses for its copyable link — with a localhost
 * fallback for non-browser clients like curl.
 */
export function appOrigin(req) {
  return APP_URL || req.get('origin') || CORS_ORIGINS[0] || 'http://localhost:5173'
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/**
 * Email the registration link to an invited person. Returns true when the
 * message was accepted by the SMTP server, false when sending is skipped
 * (unconfigured) or fails — callers surface that as `inviteEmailSent` so the
 * admin knows whether to share the link themselves.
 */
export async function sendInviteEmail({ to, name, inviteUrl }) {
  if (!transporter) return false
  const safeName = escapeHtml(name)
  const safeUrl = escapeHtml(inviteUrl)
  try {
    await transporter.sendMail({
      from: `"Orbit" <${SMTP_FROM}>`,
      to,
      subject: 'You’re invited — set up your Orbit account',
      text:
        `Hi ${name},\n\n` +
        `An account has been created for you on Orbit. Open the link below to ` +
        `choose your password and finish setting it up:\n\n${inviteUrl}\n\n` +
        `The link expires in 7 days. If it has expired, ask your admin to send a new one.\n`,
      html:
        `<p>Hi ${safeName},</p>` +
        `<p>An account has been created for you on Orbit. Click the button below to ` +
        `choose your password and finish setting it up.</p>` +
        `<p style="margin:24px 0"><a href="${safeUrl}" ` +
        `style="background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:8px;` +
        `text-decoration:none;font-weight:600;display:inline-block">Set up my account</a></p>` +
        `<p>Or copy this link into your browser:<br><a href="${safeUrl}">${safeUrl}</a></p>` +
        `<p style="color:#6b7280;font-size:13px">The link expires in 7 days. ` +
        `If it has expired, ask your admin to send a new one.</p>`,
    })
    return true
  } catch (err) {
    console.error(`[mailer] failed to send invite email to ${to}:`, err.message)
    return false
  }
}

/**
 * Email a password-reset link. Same contract as sendInviteEmail: true when
 * the SMTP server accepted the message, false when skipped or failed — the
 * forgot-password route deliberately ignores the result (its response must
 * not reveal whether an email went out; see routes/auth.js).
 */
export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  if (!transporter) return false
  const safeName = escapeHtml(name)
  const safeUrl = escapeHtml(resetUrl)
  try {
    await transporter.sendMail({
      from: `"Orbit" <${SMTP_FROM}>`,
      to,
      subject: 'Reset your Orbit password',
      text:
        `Hi ${name},\n\n` +
        `We received a request to reset your Orbit password. Open the link below ` +
        `to choose a new one:\n\n${resetUrl}\n\n` +
        `The link expires in 1 hour and can be used once. If you didn’t ask for ` +
        `this, you can safely ignore this email — your password stays unchanged.\n`,
      html:
        `<p>Hi ${safeName},</p>` +
        `<p>We received a request to reset your Orbit password. Click the button ` +
        `below to choose a new one.</p>` +
        `<p style="margin:24px 0"><a href="${safeUrl}" ` +
        `style="background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:8px;` +
        `text-decoration:none;font-weight:600;display:inline-block">Reset my password</a></p>` +
        `<p>Or copy this link into your browser:<br><a href="${safeUrl}">${safeUrl}</a></p>` +
        `<p style="color:#6b7280;font-size:13px">The link expires in 1 hour and can be ` +
        `used once. If you didn’t ask for this, you can safely ignore this email — ` +
        `your password stays unchanged.</p>`,
    })
    return true
  } catch (err) {
    console.error(`[mailer] failed to send password-reset email to ${to}:`, err.message)
    return false
  }
}
