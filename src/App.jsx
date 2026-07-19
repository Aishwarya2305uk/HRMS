import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import AdminLogin from './pages/AdminLogin'
import Portal from './pages/Portal'
import ProtectedRoute from './components/ProtectedRoute'

function App() {
  return (
    <Routes>
      {/* Public auth routes */}
      <Route path="/" element={<Login />} />
      <Route path="/admin" element={<AdminLogin />} />

      {/* Staff area (employees + managers) — one role-aware portal */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute roles={['employee', 'manager']}>
            <Portal />
          </ProtectedRoute>
        }
      />

      {/* Admin area — same portal, admin nav/sections unlocked by role */}
      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute roles={['admin']}>
            <Portal />
          </ProtectedRoute>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
