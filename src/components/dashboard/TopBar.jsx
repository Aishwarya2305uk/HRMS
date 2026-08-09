import Icon from '../Icon'
import Menu from '../Menu'
import Avatar from '../Avatar'
import { haptic, tactile } from '../../lib/haptics'
import { THEMES } from '../../lib/themes'

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
  onMenuClick,
  menuOpen,
  searchable,
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search…',
  notificationCount = 0,
  onBellClick,
  theme,
  onThemeChange,
  user,
  role,
  onLogout,
  onOpenProfile,
}) {
  return (
    <header className="emp__topbar">
      {/* Phone-only (CSS-hidden on desktop): opens the nav drawer. */}
      <button
        className="icon-btn topbar-menu-btn"
        onClick={() => { haptic('light'); onMenuClick() }}
        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={menuOpen}
        {...tactile('light')}
      >
        <Icon name="menu" size={18} />
      </button>

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
              <Avatar name={user?.name} photoUrl={user?.photoUrl} size="sm" />
              <span className={`role-pill ${role}`}>{role}</span>
              <Icon name="chevronDown" size={14} />
            </button>
          )}
        >
          <div className="user-menu__id">
            <strong>{user?.name}</strong>
            <span>{user?.email}</span>
          </div>

          {/* Theme lives inside the account menu; stopPropagation keeps the
              menu open (Menu closes on any panel click) so several accents
              can be tried in a row without reopening it. */}
          <div
            className="user-menu__theme"
            role="group"
            aria-label="Workspace theme"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="user-menu__theme-label">
              <Icon name="palette" size={14} />
              Theme
            </span>
            <div className="user-menu__swatches">
              {THEMES.map((t) => (
                <button
                  key={t.key || 'default'}
                  type="button"
                  role="menuitemradio"
                  aria-checked={t.key === (theme || '')}
                  className={`theme-swatch${t.key === (theme || '') ? ' is-selected' : ''}`}
                  style={{ background: t.swatch }}
                  title={t.label}
                  aria-label={`${t.label} theme`}
                  onClick={() => { haptic('light'); onThemeChange(t.key) }}
                />
              ))}
            </div>
          </div>

          <button role="menuitem" className="user-menu__item" onClick={onOpenProfile}>
            <Icon name="user" size={16} />
            My profile
          </button>
          <button role="menuitem" className="user-menu__item user-menu__item--danger" onClick={onLogout}>
            <Icon name="logout" size={16} />
            Log out
          </button>
        </Menu>
      </div>
    </header>
  )
}
