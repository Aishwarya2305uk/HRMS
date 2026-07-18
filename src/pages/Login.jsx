import LoginForm from '../components/LoginForm'
import './Auth.css'

/** Staff portal (employees + managers) at "/" */
export default function Login() {
  return (
    <div className="auth">
      <div className="auth__bg" aria-hidden="true">
        <span className="auth__blob auth__blob--1" />
        <span className="auth__blob auth__blob--2" />
        <span className="auth__blob auth__blob--3" />
      </div>

      {/* Left: brand / depth showcase */}
      <aside className="auth__brand">
        <div className="brand__logo">
          <span className="mark">◈</span>
          Trula&nbsp;HRMS
        </div>

        <div className="brand__headline">
          <h1>Your workday, neatly stacked.</h1>
          <p>
            Attendance, leaves and your team&apos;s org chart — all in one
            calm, layered workspace.
          </p>
        </div>

        <div className="brand__cards" aria-hidden="true">
          <div className="float-card float-card--a">
            <div className="fc-label">Leave balance</div>
            <div className="fc-value">12 days</div>
          </div>
          <div className="float-card float-card--b">
            <div className="fc-label">Today</div>
            <div className="fc-value">On time</div>
          </div>
          <div className="float-card float-card--c">
            <div className="fc-label">Team</div>
            <div className="fc-value">8 people</div>
          </div>
        </div>
      </aside>

      {/* Right: form */}
      <main className="auth__panel">
        <LoginForm
          portal="staff"
          badge="Welcome back"
          title="Sign in to Trula"
          subtitle="Use your work email to access your dashboard, leaves and team."
          demo={{ email: 'employee@trula.com', password: 'employee123' }}
        />
      </main>
    </div>
  )
}
