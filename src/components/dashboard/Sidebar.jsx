import { useState } from 'react'
import Icon from '../Icon'
import Avatar from '../Avatar'
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
  userName,
  userTitle,
  userPhotoUrl,
  collapsed,
  onToggleCollapse,
  onOpenProfile,
}) {
  // Items flagged `more` live behind the expandable "More" toggle; items
  // flagged `foot` are pinned to the bottom by .emp__nav-gap. An item flagged
  // both (admin's Feedback / HR Request) goes under More — `more` wins.
  const mainItems = nav.filter((i) => !i.foot && !i.more)
  const moreItems = nav.filter((i) => i.more)
  const footItems = nav.filter((i) => i.foot && !i.more)
  const activeInMore = moreItems.some((i) => i.key === active)
  // The More panel is a floating tile launcher (ClickUp-style): opens beside
  // the rail on desktop, above the bottom bar on mobile, and closes after any
  // pick or outside click. The More toggle carries the active highlight when
  // the current section lives inside it.
  const [moreOpen, setMoreOpen] = useState(false)
  // Inline fixed-position for the desktop panel (anchored to the More button);
  // null on mobile, where the media-query CSS pins it above the bottom bar.
  const [morePanelPos, setMorePanelPos] = useState(null)

  function toggleMore(e) {
    haptic('light')
    if (moreOpen) {
      setMoreOpen(false)
      return
    }
    if (window.matchMedia('(max-width: 760px)').matches) {
      setMorePanelPos(null)
    } else {
      const r = e.currentTarget.getBoundingClientRect()
      // Clamp so the panel never runs past the bottom of the viewport.
      setMorePanelPos({ left: r.right + 14, top: Math.max(12, Math.min(r.top, window.innerHeight - 230)) })
    }
    setMoreOpen(true)
  }

  function pickMoreItem(key) {
    haptic('light')
    onSelect(key)
    setMoreOpen(false)
  }

  // Shared by the main nav group and the foot group.
  const renderItem = (item) => (
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
      {item.badge > 0 && (
        <span className="nav-badge" aria-label={`${item.badge} ${item.badgeLabel ?? ''}`.trim()}>
          {item.badge}
        </span>
      )}
    </button>
  )

  return (
    <aside className="emp__sidebar">
      <div className="emp__logo">
        <span className="mark">◈</span>
        <div className="emp__logo-text sidebar-label">
          <span>Orbit</span>
          <em>{CONSOLE_LABEL[role] ?? 'Workspace'}</em>
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

      <nav className="emp__nav" aria-label="Main">
        {mainItems.map((item) => renderItem(item))}
        {moreItems.length > 0 && (
          <>
            <button
              type="button"
              className={`nav-item nav-more${activeInMore ? ' is-active' : ''}`}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-label="More"
              title="More"
              onClick={toggleMore}
              {...tactile('light')}
            >
              <Icon name="moreHorizontal" size={19} />
              <span className="sidebar-label">More</span>
            </button>
            {moreOpen && (
              <>
                <div className="nav-more__backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true" />
                <div className="nav-more__group" role="menu" style={morePanelPos ?? undefined}>
                  {moreItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="menuitem"
                      className={`more-tile${active === item.key ? ' is-active' : ''}`}
                      aria-current={active === item.key ? 'page' : undefined}
                      title={item.label}
                      onClick={() => pickMoreItem(item.key)}
                      {...tactile('light')}
                    >
                      <span className="more-tile__icon">
                        <Icon name={item.icon} size={19} />
                      </span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {footItems.length > 0 && <div className="emp__nav-gap" aria-hidden="true" />}
        {footItems.map((item) => renderItem(item))}
      </nav>

      <div className="emp__side-foot">
        <button
          type="button"
          className="mini-profile"
          onClick={() => { haptic('light'); onOpenProfile?.() }}
          aria-label="Open your profile"
        >
          <Avatar name={userName} photoUrl={userPhotoUrl} />
          <div className="mini-profile__text sidebar-label">
            <strong>{userName}</strong>
            <span>{userTitle || role}</span>
          </div>
        </button>
      </div>
    </aside>
  )
}
