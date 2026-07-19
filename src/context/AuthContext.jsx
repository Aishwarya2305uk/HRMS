import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { apiFetch, setToken, getToken, ApiError } from '../lib/api'

const AuthContext = createContext(null)

/**
 * Auth provider backed by the Express + MongoDB API.
 * - login()  -> POST /api/auth/login, stores JWT, sets user
 * - on mount -> if a token exists, GET /api/auth/me to restore the session
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

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

  /**
   * @returns {Promise<{ok:true,user}|{ok:false,error:string}>}
   */
  async function login(email, password, portal = 'staff') {
    try {
      const { token, user } = await apiFetch('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email, password, portal },
      })
      setToken(token)
      setUser(user)
      return { ok: true, user }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Something went wrong. Try again.'
      return { ok: false, error: message }
    }
  }

  function logout() {
    setToken(null)
    setUser(null)
  }

  /** Re-fetch the current user (e.g. after a leave balance changes). */
  async function refreshUser() {
    try {
      const { user } = await apiFetch('/auth/me')
      setUser(user)
      return user
    } catch {
      return null
    }
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      role: user?.role ?? null,
      login,
      logout,
      refreshUser,
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
