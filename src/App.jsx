import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import SignUp from './pages/SignUp'
import ResetPassword from './pages/ResetPassword'
import Portal from './pages/Portal'
import ProtectedRoute from './components/ProtectedRoute'

function App() {
  return (
    <Routes>
      {/* Public auth route — single sign-in page for every role */}
      <Route path="/" element={<Login />} />
      {/* Old bookmark alias from when sign-in briefly lived at /login */}
      <Route path="/login" element={<Navigate to="/" replace />} />

      {/* Invite-only registration — completes an admin-created account */}
      <Route path="/signup" element={<SignUp />} />

      {/* Self-service password reset — request the emailed link, or land
          from it with ?token to set the new password */}
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Staff area (employees + managers) — one role-aware portal. The
          section lives in the path (/dashboard/leaves) and a profile may
          name a record (/dashboard/profile/<id>), so a refresh, the Back
          button and a bookmark all land on the same page — see Portal.jsx. */}
      <Route
        path="/dashboard/:section?/:id?"
        element={
          <ProtectedRoute roles={['employee', 'manager']}>
            <Portal />
          </ProtectedRoute>
        }
      />

      {/* Admin area — same portal, admin nav/sections unlocked by role */}
      <Route
        path="/admin/dashboard/:section?/:id?"
        element={
          <ProtectedRoute roles={['admin']}>
            <Portal />
          </ProtectedRoute>
        }
      />

      {/* Fallback — also catches the old /admin login bookmark */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
