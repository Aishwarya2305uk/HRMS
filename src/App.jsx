import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import AdminLogin from './pages/AdminLogin'
import Dashboard from './pages/Dashboard'
import EmployeeDashboard from './pages/EmployeeDashboard'
import ProtectedRoute from './components/ProtectedRoute'

function App() {
  return (
    <Routes>
      {/* Public auth routes */}
      <Route path="/" element={<Login />} />
      <Route path="/admin" element={<AdminLogin />} />

      {/* Staff area (employees + managers) */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute roles={['employee', 'manager']}>
            <EmployeeDashboard />
          </ProtectedRoute>
        }
      />

      {/* Admin area */}
      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute roles={['admin']}>
            <Dashboard />
          </ProtectedRoute>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
