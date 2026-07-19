import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiFetch, setToken, getToken, ApiError, SESSION_EXPIRED_EVENT } from '../lib/api'

const AuthContext = createContext(null)

/**
 * Auth provider backed by the Express + MongoDB API.
 * - login()  -> POST /api/auth/login, stores JWT, sets user
 * - on mount -> if a token exists, GET /api/auth/me to restore the session
 * - listens for SESSION_EXPIRED_EVENT so an expired token signs the user out
 *   once, with an explanation, instead of every screen erroring separately.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  /** Explains *why* the user landed back on the login screen. */
  const [notice, setNotice] = useState('')

  // Restore session on first load.
  useEffect(() => {
    let active = true
    async function restore() {
      if (!getToken()) {
        setLoading(false)
        return
      }
      try {
        const { user } = await apiFetch('/auth/me')
        if (active) setUser(user)
      } catch {
        setToken(null) // token invalid/expired
      } finally {
        if (active) setLoading(false)
      }
    }
    restore()
    return () => {
      active = false
    }
  }, [])

  // One place handles a dead session, no matter which request discovered it.
  useEffect(() => {
    function onExpired() {
      setToken(null)
      setUser((prev) => {
        // Only explain it if they were actually signed in a moment ago.
        if (prev) setNotice('Your session expired. Please sign in again.')
        return null
      })
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  /**
   * @returns {Promise<{ok:true,user}|{ok:false,error:string}>}
   */
  const login = useCallback(async (email, password, portal = 'staff') => {
    try {
      const { token, user } = await apiFetch('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email, password, portal },
      })
      setToken(token)
      setUser(user)
      setNotice('')
      return { ok: true, user }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'
      return { ok: false, error: message }
    }
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setNotice('')
  }, [])

  /** Re-fetch the current user (e.g. after a leave balance changes). */
  const refreshUser = useCallback(async () => {
    try {
      const { user } = await apiFetch('/auth/me')
      setUser(user)
      return user
    } catch {
      return null
    }
  }, [])

  const clearNotice = useCallback(() => setNotice(''), [])

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      role: user?.role ?? null,
      notice,
      clearNotice,
      login,
      logout,
      refreshUser,
    }),
    [user, loading, notice, clearNotice, login, logout, refreshUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
