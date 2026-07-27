import LoginForm from '../components/LoginForm'
import './Auth.css'

export default function Login() {
  return (
    <div className="auth">
      {/* Left: brand panel */}
      <aside className="auth__brand">
        <div className="brand__logo">
          <span className="mark">◈</span>
          Trula&nbsp;HRMS
        </div>

        <div className="brand__intro">
          <h1>Workforce management, simplified.</h1>
          <p>Attendance, leave and organization management in one place.</p>
        </div>

        <blockquote className="brand__quote">
          <p>&ldquo;Take care of your employees and they&apos;ll take care of your business.&rdquo;</p>
          <cite>Richard Branson</cite>
        </blockquote>
      </aside>

      {/* Right: form */}
      <main className="auth__panel">
        <LoginForm />
      </main>
    </div>
  )
}
