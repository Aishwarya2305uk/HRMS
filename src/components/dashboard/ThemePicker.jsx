import Icon from '../Icon'
import Menu from '../Menu'
import { haptic, tactile } from '../../lib/haptics'
import { THEMES } from '../../lib/themes'

/**
 * Topbar palette dropdown — lets any role pick one of the 10 workspace
 * themes (see lib/themes.js). The little dot on the trigger mirrors the
 * currently active accent so the control shows your choice at a glance.
 */
export default function ThemePicker({ theme, onChange }) {
  const current = THEMES.find((t) => t.key === theme) ?? THEMES[0]
  return (
    <Menu
      label="Choose a theme"
      trigger={({ toggle, ref, ...aria }) => (
        <button
          className="icon-btn theme-trigger"
          onClick={() => { haptic('light'); toggle() }}
          ref={ref}
          aria-label={`Change theme (current: ${current.label})`}
          title="Change theme"
          {...aria}
          {...tactile('light')}
        >
          <Icon name="palette" size={18} />
          <span className="theme-trigger__dot" style={{ background: current.swatch }} aria-hidden="true" />
        </button>
      )}
    >
      <div className="user-menu__id">
        <strong>Theme</strong>
        <span>Pick an accent for your workspace</span>
      </div>
      {THEMES.map((t) => (
        <button
          key={t.key || 'default'}
          role="menuitemradio"
          aria-checked={t.key === current.key}
          className={`user-menu__item theme-option${t.key === current.key ? ' is-selected' : ''}`}
          onClick={() => { haptic('light'); onChange(t.key) }}
        >
          <span className="theme-option__swatch" style={{ background: t.swatch }} aria-hidden="true" />
          {t.label}
          {t.key === current.key && <Icon name="check" size={14} className="theme-option__check" />}
        </button>
      ))}
    </Menu>
  )
}
