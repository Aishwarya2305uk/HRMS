/**
 * Fetch wrapper for the HRMS API. Calls go to /api/* which Vite proxies to the
 * Express backend in dev (see vite.config.js) and which Vercel routes to the
 * serverless function in production.
 *
 * Error philosophy:
 *  - Every failure surfaces as an ApiError with a message a *user* can act on.
 *  - We never show raw server/DB internals; unknown 5xx becomes a generic line.
 *  - 401 is special: it means the session died, so we broadcast one event and
 *    let AuthContext sign the user out cleanly instead of each caller guessing.
 */
const TOKEN_KEY = 'hrms.token'

/** Requests that hang longer than this are aborted with a friendly message. */
const TIMEOUT_MS = 15000

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

/** Fired once when the server rejects our token — AuthContext listens. */
export const SESSION_EXPIRED_EVENT = 'hrms:session-expired'

export class ApiError extends Error {
  constructor(message, status, { retryable = false } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    /** Whether offering the user a "Try again" button makes sense. */
    this.retryable = retryable
  }
}

/**
 * Turn an HTTP status into something a person can understand and act on.
 * The server's own message wins for deliberate, user-facing 4xx responses
 * (e.g. "Only 3 day(s) of casual leave remain") — those are written for users.
 * For 5xx we always use our own copy so internal details never leak.
 */
function humanize(status, serverMessage) {
  if (status >= 500) {
    return 'Something went wrong on our end. Please try again in a moment.'
  }
  if (serverMessage) return serverMessage

  switch (status) {
    case 400:
    case 422:
      return 'Some of the details look incorrect. Please check and try again.'
    case 401:
      return 'Your session has expired. Please sign in again.'
    case 403:
      return "You don't have permission to do that."
    case 404:
      return "We couldn't find what you were looking for."
    case 409:
      return 'That conflicts with something that already exists.'
    case 429:
      return 'Too many attempts. Please wait a moment and try again.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

export async function apiFetch(path, { method = 'GET', body, auth = true, signal } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`

  // Fail fast rather than leaving the user staring at a spinner forever.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true })

  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    // Caller cancelled (e.g. component unmounted) — not a user-facing failure.
    if (signal?.aborted) throw new ApiError('Request cancelled.', 0)
    if (err?.name === 'AbortError') {
      throw new ApiError('That took too long to respond. Please try again.', 0, {
        retryable: true,
      })
    }
    // Offline or server unreachable — tailor the message to what we can detect.
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    throw new ApiError(
      offline
        ? 'You appear to be offline. Check your connection and try again.'
        : "We couldn't reach the server. Please check your connection and try again.",
      0,
      { retryable: true },
    )
  }
  clearTimeout(timer)

  let data = null
  try {
    data = await res.json()
  } catch {
    /* empty body is fine */
  }

  if (!res.ok) {
    // A dead session should sign the user out everywhere, not just here.
    if (res.status === 401 && auth && token) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
    }
    throw new ApiError(humanize(res.status, data?.error), res.status, {
      retryable: res.status >= 500 || res.status === 429,
    })
  }
  return data
}
