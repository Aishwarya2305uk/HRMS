import Icon from '../Icon'
import { haptic, tactile } from '../../lib/haptics'

const TINT = {
  attendance: 'blue',
  leaves: 'green',
  approvals: 'amber',
  people: 'indigo',
  allleaves: 'amber',
  org: 'indigo',
  calendar: 'blue',
}

/**
 * Folder-style shortcut row on the dashboard landing view — a fast way to
 * jump into any other section without hunting the sidebar.
 */
export default function QuickAccessTiles({ items, onSelect }) {
  if (!items.length) return null
  return (
    <section className="quick-tiles" aria-label="Quick access">
      {items.map((item, i) => (
        <button
          key={item.key}
          className={`quick-tile tint-${TINT[item.key] || 'indigo'}`}
          style={{ '--d': `${i * 40}ms` }}
          onClick={() => { haptic('light'); onSelect(item.key) }}
          {...tactile('light')}
        >
          <span className="quick-tile__icon"><Icon name={item.icon} size={20} /></span>
          <span className="quick-tile__label">{item.label}</span>
        </button>
      ))}
    </section>
  )
}
