import { useEffect, useState } from 'react'
import Icon from '../Icon'
import Avatar from '../Avatar'
import { haptic, tactile } from '../../lib/haptics'

const CONSOLE_LABEL = {
  admin: 'Admin console',
  manager: 'Manager console',
  employee: 'My workspace',
}

/**
 * Dark icon-rail navigation. Sticky full-height on desktop; on phones the
 * same rail parks off-canvas as a LEFT drawer (never a bottom bar) that the
 * topbar hamburger slides in — `mobileOpen` mirrors the `.emp--nav-open`
 * class Portal puts on the page root, and `onCloseMobile` dismisses it
 * (backdrop click / Escape; Portal also closes it on any section pick).
 * The active item's accent color comes from the role theme set on the .emp
 * root (see Portal.jsx's data-role attribute).
 *
 * Independently, `collapsed` shrinks the desktop rail down to icons-only —
 * driven by the `.emp--collapsed` class on the page root (Portal.jsx), which
 * also narrows the CSS grid column so the main content reclaims the space.
 * (Desktop-only: the drawer always shows full labels.)
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
  mobileOpen,
  onCloseMobile,
}) {
  // Items flagged `more` live behind the expandable "More" toggle; the rest
  // render directly in the rail, in nav order.
  // The More toggle slots in where the first `more` item falls in nav order —
  // for admin that's after every direct item, so More sits last in the rail.
  const moreItems = nav.filter((i) => i.more)
  const isMain = (i) => !i.more
  const firstMore = nav.findIndex((i) => i.more)
  const mainBefore = (firstMore === -1 ? nav : nav.slice(0, firstMore)).filter(isMain)
  const mainAfter = firstMore === -1 ? [] : nav.slice(firstMore).filter(isMain)
  const activeInMore = moreItems.some((i) => i.key === active)
  // The More panel is a floating tile launcher (ClickUp-style): opens beside
  // the rail on desktop, above the bottom bar on mobile, and closes after any
  // pick or outside click. The More toggle carries the active highlight when
  // the current section lives inside it.
  const [moreOpen, setMoreOpen] = useState(false)
  // Inline fixed-position for the desktop panel (anchored to the More button);
  // null on phones, where the media-query CSS pins it as a bottom sheet.
  const [morePanelPos, setMorePanelPos] = useState(null)

  // Escape dismisses the phone drawer, like any overlay.
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseMobile()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen, onCloseMobile])

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
      // Clamp so the panel never runs past the bottom of the viewport —
      // estimate its height from the 3-per-row tile grid.
      const panelH = Math.ceil(moreItems.length / 3) * 95 + 40
      setMorePanelPos({ left: r.right + 14, top: Math.max(12, Math.min(r.top, window.innerHeight - panelH)) })
    }
    setMoreOpen(true)
  }

  function pickMoreItem(key) {
    haptic('light')
    onSelect(key)
    setMoreOpen(false)
  }

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
    <>
      {/* Scrim behind the phone drawer — tap anywhere outside to close.
          CSS keeps it display:none on desktop widths. */}
      {mobileOpen && (
        <div className="emp__nav-backdrop" onClick={onCloseMobile} aria-hidden="true" />
      )}
      <aside className="emp__sidebar">
      <div className="emp__logo">
        <span className="mark">
          <img src="/logo.svg" alt="" />
        </span>
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
        {mainBefore.map((item) => renderItem(item))}
        {moreItems.length > 0 && (
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
        )}
        {mainAfter.map((item) => renderItem(item))}
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

      {/* Deliberately OUTSIDE the aside: the phone drawer's transform makes
          the aside the containing block for fixed-position descendants, which
          would drag this panel (and its backdrop) along with the drawer
          instead of pinning them to the viewport. */}
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
  )
}
