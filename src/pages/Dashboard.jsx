import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './Dashboard.css'

/**
 * Placeholder home shown after login. Adapts its tiles to the user's role.
 * The full dashboards (attendance timer, leave flow, org tree, calendar,
 * manager approvals, admin employee management) come next.
 */
export default function Dashboard() {
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/', { replace: true })
  }

  const isAdmin = role === 'admin'

  const tiles = [
    { ico: '🕒', title: 'Attendance', desc: 'Check in / out and track your hours.' },
    { ico: '🌴', title: 'Leaves', desc: 'Apply for leave and track balance & status.' },
    { ico: '🗂️', title: 'Organization tree', desc: 'See who reports to whom.' },
    { ico: '📅', title: 'Leave calendar', desc: 'Your leaves plus company-wide view.' },
  ]
  if (role === 'manager') {
    tiles.push({ ico: '✅', title: 'Approvals', desc: "Approve or reject your reports' leave." })
  }
  if (isAdmin) {
    tiles.push({ ico: '👥', title: 'Manage people', desc: 'Add employees and set managers.' })
  }

  return (
    <div className="dash">
      <header className="dash__top">
        <div className="dash__brand">
          <span className="mark">◈</span> Trula HRMS
        </div>
        <div className="dash__user">
          <span>{user?.name}</span>
          <span className={`role-chip${isAdmin ? ' admin' : ''}`}>{role}</span>
          <button className="dash__logout" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <div className="dash__body">
        <section className="dash__hero">
          <h1>Welcome, {user?.name?.split(' ')[0]} 👋</h1>
          <p>
            You&apos;re signed in as <b>{role}</b>
            {user?.designation ? ` · ${user.designation}` : ''}. Your login
            worked — the full {isAdmin ? 'admin console' : 'dashboard'} is being
            built next.
          </p>

          <div className="dash__grid">
            {tiles.map((t) => (
              <article className="dash__tile" key={t.title}>
                <div className="ico">{t.ico}</div>
                <h3>{t.title}</h3>
                <p>{t.desc}</p>
                <span className="dash__soon">Coming soon</span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
