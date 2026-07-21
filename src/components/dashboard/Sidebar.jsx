import Icon from '../Icon'
import { haptic, tactile } from '../../lib/haptics'

const CONSOLE_LABEL = {
  admin: 'Admin console',
  manager: 'Manager console',
  employee: 'Employee workspace',
}

/**
 * Dark icon-rail navigation. Sticky full-height on desktop, collapses to a
 * fixed bottom bar on narrow screens (see .emp__sidebar responsive rules).
 * The active item's accent color comes from the role theme set on the .emp
 * root (see Portal.jsx's data-role attribute).
 *
 * Independently, `collapsed` shrinks the desktop rail down to icons-only —
 * driven by the `.emp--collapsed` class on the page root (Portal.jsx), which
 * also narrows the CSS grid column so the main content reclaims the space.
 */
export default function Sidebar({
  nav,
  active,
  onSelect,
  role,
  pendingCount,
  userName,
  userTitle,
  collapsed,
  onToggleCollapse,
}) {
  return (
    <aside className="emp__sidebar">
      <div className="emp__logo">
        <span className="mark">◈</span>
        <div className="emp__logo-text sidebar-label">
          <span>Trula</span>
          <em>{CONSOLE_LABEL[role] ?? 'Workspace'}</em>
        </div>
      </div>

      <nav className="emp__nav" aria-label="Main">
        {nav.map((item) => (
          <button
            key={item.key}
            className={`nav-item${active === item.key ? ' is-active' : ''}`}
            aria-current={active === item.key ? 'page' : undefined}
            aria-label={item.label}
            title={item.label}
            onClick={() => { haptic('light'); onSelect(item.key) }}
            {...tactile('light')}
          >
            <Icon name={item.icon} size={19} />
            <span className="sidebar-label">{item.label}</span>
            {item.key === 'approvals' && pendingCount > 0 && (
              <span className="nav-badge" aria-label={`${pendingCount} pending`}>
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="emp__side-foot">
        <div className="mini-profile">
          <div className="avatar" aria-hidden="true">{userName?.[0] ?? '?'}</div>
          <div className="mini-profile__text sidebar-label">
            <strong>{userName}</strong>
            <span>{userTitle || role}</span>
          </div>
        </div>

        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={() => { haptic('light'); onToggleCollapse() }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
        >
          <Icon name="chevronsLeft" size={16} className={`collapse-chevron${collapsed ? ' is-collapsed' : ''}`} />
          <span className="sidebar-label">Collapse</span>
        </button>
      </div>
    </aside>
  )
}
