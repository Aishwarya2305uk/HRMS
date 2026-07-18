import LoginForm from '../components/LoginForm'
import './Auth.css'

/** Admin portal at "/admin" */
export default function AdminLogin() {
  return (
    <div className="auth auth--admin">
      <div className="auth__bg" aria-hidden="true">
        <span className="auth__blob auth__blob--1" />
        <span className="auth__blob auth__blob--2" />
        <span className="auth__blob auth__blob--3" />
      </div>

      <aside className="auth__brand auth__brand--admin">
        <div className="brand__logo">
          <span className="mark">◈</span>
          Trula&nbsp;HRMS
        </div>

        <div className="brand__headline">
          <h1>Admin console.</h1>
          <p>
            Add people, wire up the reporting tree and keep the whole
            organization in view.
          </p>
        </div>

        <div className="brand__cards" aria-hidden="true">
          <div className="float-card float-card--a">
            <div className="fc-label">Headcount</div>
            <div className="fc-value">126</div>
          </div>
          <div className="float-card float-card--b">
            <div className="fc-label">Pending leaves</div>
            <div className="fc-value">7</div>
          </div>
          <div className="float-card float-card--c">
            <div className="fc-label">Departments</div>
            <div className="fc-value">9</div>
          </div>
        </div>
      </aside>

      <main className="auth__panel">
        <LoginForm
          portal="admin"
          badge="Admin access"
          title="Admin sign in"
          subtitle="Restricted area. Administrator credentials required."
          demo={{ email: 'admin@trula.com', password: 'admin123' }}
        />
      </main>
    </div>
  )
}
