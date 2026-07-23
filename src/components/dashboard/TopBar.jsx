import Icon from '../Icon'
import Menu from '../Menu'
import { haptic, tactile } from '../../lib/haptics'

/**
 * Top bar: page title, an (optionally active) search box, a notifications
 * bell, and the account menu. Search only does something on sections that
 * expose a filterable list (see Portal.jsx's SEARCHABLE_TABS) — everywhere
 * else it's simply not shown, rather than sitting there looking broken.
 */
export default function TopBar({
  dateLabel,
  title,
  greeting,
  searchable,
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search…',
  notificationCount = 0,
  onBellClick,
  user,
  role,
  onLogout,
}) {
  return (
    <header className="emp__topbar">
      <div className="emp__topbar-left">
        <p className="emp__eyebrow">{dateLabel}</p>
        <h1>{greeting ?? title}</h1>
      </div>

      {searchable && (
        <div className="topbar-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </div>
      )}

      <div className="emp__top-actions">
        <button
          className="icon-btn"
          onClick={() => { haptic('light'); onBellClick() }}
          aria-label={notificationCount > 0 ? `${notificationCount} unread notifications` : 'Notifications'}
          {...tactile('light')}
        >
          <Icon name="bell" size={18} />
          {notificationCount > 0 && <span className="dot" aria-hidden="true" />}
        </button>

        <Menu
          label="Account menu"
          trigger={({ toggle, ref, ...aria }) => (
            <button className="user-trigger" onClick={toggle} ref={ref} {...aria} {...tactile('light')}>
              <span className="avatar sm" aria-hidden="true">{user?.name?.[0] ?? '?'}</span>
              <span className={`role-pill ${role}`}>{role}</span>
              <Icon name="chevronDown" size={14} />
            </button>
          )}
        >
          <div className="user-menu__id">
            <strong>{user?.name}</strong>
            <span>{user?.email}</span>
          </div>
          <button role="menuitem" className="user-menu__item user-menu__item--danger" onClick={onLogout}>
            <Icon name="logout" size={16} />
            Log out
          </button>
        </Menu>
      </div>
    </header>
  )
}
