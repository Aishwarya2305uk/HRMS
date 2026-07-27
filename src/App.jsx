import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Portal from './pages/Portal'
import ProtectedRoute from './components/ProtectedRoute'

function App() {
  return (
    <Routes>
      {/* Public auth route — single sign-in page for every role */}
      <Route path="/" element={<Login />} />

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

      {/* Fallback — also catches the old /admin login bookmark */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
