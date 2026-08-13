import LoginForm from '../components/LoginForm'
import RotatingQuote from '../components/RotatingQuote'
import './Auth.css'

export default function Login() {
  return (
    <div className="auth">
      {/* Left: brand panel */}
      <aside className="auth__brand">
        <div className="brand__logo">
          <span className="mark">
            <img src="/logo.svg" alt="" />
          </span>
          <span className="brand__wordmark">
            <strong>ORBIT</strong>
            <em>by Trula.ai</em>
          </span>
        </div>

        <div className="brand__intro">
          <h1>Your whole workforce, in one orbit.</h1>
          <p>Attendance, leave and organization management in one place.</p>
        </div>

        <RotatingQuote />
      </aside>

      {/* Right: form */}
      <main className="auth__panel">
        <LoginForm />
      </main>
    </div>
  )
}
