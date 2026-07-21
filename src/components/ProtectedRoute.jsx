import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * Gate a route behind authentication and (optionally) a set of roles.
 * NOTE: this is UI-level protection only. The real access control must be
 * enforced on the backend for every data request.
 *
 * @param {object} props
 * @param {string[]} [props.roles]  allowed roles; omit to allow any authed user
 * @param {React.ReactNode} props.children
 */
export default function ProtectedRoute({ roles, children }) {
  const { isAuthenticated, role, loading } = useAuth()
  const location = useLocation()

  // Wait for the session-restore check before deciding to redirect,
  // otherwise a refresh on a protected page bounces to login.
  if (loading) {
    return (
      <div className="route-loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span className="sr-only">Loading…</span>
      </div>
    )
  }

  if (!isAuthenticated) {
    // Send admins-only routes to the admin login, everything else to staff.
    const loginPath = location.pathname.startsWith('/admin') ? '/admin' : '/'
    return <Navigate to={loginPath} state={{ from: location }} replace />
  }

  if (roles && !roles.includes(role)) {
    // Authenticated but wrong role — bounce to their own home.
    const home = role === 'admin' ? '/admin/dashboard' : '/dashboard'
    return <Navigate to={home} replace />
  }

  return children
}
