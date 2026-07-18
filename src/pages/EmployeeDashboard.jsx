import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icon'
import { haptic, tactile } from '../lib/haptics'
import './EmployeeDashboard.css'

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { key: 'attendance', label: 'Attendance', icon: 'clock' },
  { key: 'leaves', label: 'Leaves', icon: 'leaf' },
  { key: 'org', label: 'Organization', icon: 'tree' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
]

// Illustrative until the leave API is wired in.
const RECENT_LEAVES = [
  { id: 1, type: 'Casual Leave', range: 'Jul 22 – Jul 23', days: 2, status: 'pending' },
  { id: 2, type: 'Sick Leave', range: 'Jul 08', days: 1, status: 'approved' },
  { id: 3, type: 'Earned Leave', range: 'Jun 19 – Jun 20', days: 2, status: 'approved' },
  { id: 4, type: 'Casual Leave', range: 'May 30', days: 1, status: 'rejected' },
]

function pad(n) {
  return String(n).padStart(2, '0')
}
function formatElapsed(ms) {
  const s = Math.floor(ms / 1000)
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}
function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

export default function EmployeeDashboard() {
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()
  const [active, setActive] = useState('dashboard')

  // ---- Functional check-in timer (persisted per user + day) ----
  const storageKey = `hrms.attendance.${user?.id}.${todayKey()}`
  const [checkedInAt, setCheckedInAt] = useState(() => {
    const raw = localStorage.getItem(storageKey)
    return raw ? JSON.parse(raw).checkedInAt ?? null : null
  })
  const [now, setNow] = useState(Date.now())
  const tick = useRef(null)

  useEffect(() => {
    if (checkedInAt) {
      tick.current = setInterval(() => setNow(Date.now()), 1000)
      return () => clearInterval(tick.current)
    }
  }, [checkedInAt])

  function toggleCheckIn() {
    if (checkedInAt) {
      haptic('warning')
      localStorage.removeItem(storageKey)
      setCheckedInAt(null)
    } else {
      haptic('success')
      const ts = Date.now()
      localStorage.setItem(storageKey, JSON.stringify({ checkedInAt: ts }))
      setCheckedInAt(ts)
      setNow(ts)
    }
  }

  function handleLogout() {
    haptic('medium')
    logout()
    navigate('/', { replace: true })
  }

  const firstName = user?.name?.split(' ')[0] ?? 'there'
  const elapsed = checkedInAt ? formatElapsed(now - checkedInAt) : '00:00:00'
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const stats = [
    { icon: 'leaf', tint: 'indigo', label: 'Leave balance', value: user?.leaveBalance ?? 0, unit: 'days' },
    { icon: 'check', tint: 'green', label: 'Present this month', value: 18, unit: 'days' },
    { icon: 'clock', tint: 'blue', label: 'Avg. hours / day', value: '8h 12m', unit: '' },
    { icon: 'trending', tint: 'amber', label: 'On-time rate', value: '96%', unit: '' },
  ]

  return (
    <div className="emp">
      {/* ---------------- Sidebar ---------------- */}
      <aside className="emp__sidebar">
        <div className="emp__logo">
          <span className="mark">◈</span>
          <span>Trula</span>
        </div>

        <nav className="emp__nav">
          {NAV.map((item) => (
            <button
              key={item.key}
              className={`nav-item${active === item.key ? ' is-active' : ''}`}
              onClick={() => {
                haptic('light')
                setActive(item.key)
              }}
              {...tactile('light')}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="emp__side-foot">
          <div className="mini-profile">
            <div className="avatar" aria-hidden="true">
              {firstName[0]}
            </div>
            <div className="mini-profile__text">
              <strong>{user?.name}</strong>
              <span>{user?.designation}</span>
            </div>
          </div>
          <button className="nav-item logout" onClick={handleLogout} {...tactile('medium')}>
            <Icon name="logout" size={19} />
            <span>Log out</span>
          </button>
        </div>
      </aside>

      {/* ---------------- Main ---------------- */}
      <div className="emp__main">
        <header className="emp__topbar">
          <div>
            <p className="emp__eyebrow">{dateLabel}</p>
            <h1>
              Good to see you, {firstName} <span className="wave">👋</span>
            </h1>
          </div>
          <div className="emp__top-actions">
            <button className="icon-btn" aria-label="Notifications" {...tactile('light')}>
              <Icon name="bell" size={20} />
              <span className="dot" />
            </button>
            <span className={`role-pill ${role}`}>{role}</span>
          </div>
        </header>

        <div className="emp__content">
          {/* Stat cards */}
          <section className="stat-row">
            {stats.map((s, i) => (
              <article
                key={s.label}
                className={`card stat pop tint-${s.tint}`}
                style={{ '--d': `${i * 70}ms` }}
                tabIndex={0}
                {...tactile('light')}
              >
                <span className="stat__icon">
                  <Icon name={s.icon} size={20} />
                </span>
                <div className="stat__meta">
                  <span className="stat__label">{s.label}</span>
                  <span className="stat__value">
                    {s.value}
                    {s.unit && <em>{s.unit}</em>}
                  </span>
                </div>
              </article>
            ))}
          </section>

          <div className="emp__grid">
            {/* Attendance check-in */}
            <section
              className={`card attendance pop${checkedInAt ? ' is-active' : ''}`}
              style={{ '--d': '300ms' }}
            >
              <div className="attendance__head">
                <h2>Attendance</h2>
                <span className={`live ${checkedInAt ? 'on' : 'off'}`}>
                  <span className="live__dot" />
                  {checkedInAt ? 'Checked in' : 'Checked out'}
                </span>
              </div>

              <div className="attendance__timer" aria-live="polite">
                {elapsed}
              </div>
              <p className="attendance__hint">
                {checkedInAt
                  ? 'Timer is running. Remember to check out when you leave.'
                  : "You're not checked in yet. Start your day whenever you're ready."}
              </p>

              <button
                className={`btn-tactile ${checkedInAt ? 'danger' : 'primary'} block`}
                onClick={toggleCheckIn}
              >
                <Icon name={checkedInAt ? 'logout' : 'check'} size={18} />
                {checkedInAt ? 'Check out' : 'Check in'}
              </button>
              <p className="attendance__note">
                Logging in doesn&apos;t mark attendance — use this timer.
              </p>
            </section>

            {/* Leave balance + quick apply */}
            <section className="card leave-balance pop" style={{ '--d': '370ms' }}>
              <div className="attendance__head">
                <h2>Leave balance</h2>
                <button className="link-btn" {...tactile('light')}>
                  History
                </button>
              </div>

              <div className="ring-wrap">
                <div
                  className="ring"
                  style={{ '--pct': `${Math.min(100, ((user?.leaveBalance ?? 0) / 24) * 100)}%` }}
                >
                  <div className="ring__center">
                    <strong>{user?.leaveBalance ?? 0}</strong>
                    <span>of 24 days</span>
                  </div>
                </div>
                <ul className="leave-legend">
                  <li><span className="lg indigo" /> Earned <b>10</b></li>
                  <li><span className="lg blue" /> Casual <b>6</b></li>
                  <li><span className="lg green" /> Sick <b>{Math.max(0, (user?.leaveBalance ?? 0) - 16)}</b></li>
                </ul>
              </div>

              <button className="btn-tactile primary block" onClick={() => haptic('medium')}>
                <Icon name="plus" size={18} />
                Apply for leave
              </button>
            </section>

            {/* Recent leave requests */}
            <section className="card requests pop" style={{ '--d': '440ms' }}>
              <div className="attendance__head">
                <h2>Recent leave requests</h2>
                <button className="link-btn" {...tactile('light')}>
                  View all
                </button>
              </div>

              <ul className="req-list">
                {RECENT_LEAVES.map((l) => (
                  <li key={l.id} className="req" tabIndex={0} {...tactile('light')}>
                    <span className="req__type">
                      <Icon name="leaf" size={16} />
                      <span>
                        <strong>{l.type}</strong>
                        <em>{l.range} · {l.days} {l.days > 1 ? 'days' : 'day'}</em>
                      </span>
                    </span>
                    <span className={`status ${l.status}`}>{l.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
