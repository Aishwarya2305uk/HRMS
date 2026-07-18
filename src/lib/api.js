/**
 * Tiny fetch wrapper for the HRMS API. Calls go to /api/* which Vite
 * proxies to the Express backend in dev (see vite.config.js).
 */
const TOKEN_KEY = 'hrms.token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    // Network / server-down case.
    throw new ApiError(
      'Cannot reach the server. Is the backend running (npm run server)?',
      0,
    )
  }

  let data = null
  try {
    data = await res.json()
  } catch {
    /* empty body is fine */
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status}).`, res.status)
  }
  return data
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}
