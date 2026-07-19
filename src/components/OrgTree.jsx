import { useState } from 'react'
import { haptic } from '../lib/haptics'
import { EmptyState } from './States'

const ROLE_TINT = { admin: 'indigo', manager: 'blue', employee: 'green' }

/** One node + its (collapsible) reports. Recursive. */
function OrgNode({ node, depth = 0, currentUserId }) {
  const [open, setOpen] = useState(depth < 2) // expand the top couple of levels
  const hasReports = node.reports?.length > 0
  const isYou = node.id === currentUserId

  return (
    <li className="org-node">
      <div className={`org-card${isYou ? ' is-you' : ''}`}>
        <span className={`avatar sm tint-${ROLE_TINT[node.role] || 'indigo'}`} aria-hidden="true">
          {node.name?.[0] ?? '?'}
        </span>
        <div className="org-card__text">
          <strong>
            {node.name}
            {isYou && <span className="you-tag">You</span>}
          </strong>
          <em>{node.designation || node.role}{node.department ? ` · ${node.department}` : ''}</em>
        </div>
        {hasReports && (
          <button
            className="org-toggle"
            onClick={() => { haptic('light'); setOpen((o) => !o) }}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            <span className="count-pill">{node.reports.length}</span>
            <span className={`chev${open ? ' open' : ''}`}>▾</span>
          </button>
        )}
      </div>

      {hasReports && open && (
        <ul className="org-children">
          {node.reports.map((child) => (
            <OrgNode key={child.id} node={child} depth={depth + 1} currentUserId={currentUserId} />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * Company reporting tree, built from the manager self-reference. Visible to all
 * roles.
 * @param {Array}  props.roots          top-level nodes from /employees/org-tree
 * @param {string} props.currentUserId  to highlight "You"
 */
export default function OrgTree({ roots, currentUserId }) {
  return (
    <section className="card pop" style={{ '--d': '120ms' }}>
      <div className="attendance__head">
        <h2>Organization</h2>
      </div>
      {(!roots || roots.length === 0) ? (
        <EmptyState
          icon="tree"
          title="No reporting structure yet"
          message="The tree builds itself as an admin adds people and assigns their managers."
        />
      ) : (
        <ul className="org-tree">
          {roots.map((r) => (
            <OrgNode key={r.id} node={r} currentUserId={currentUserId} />
          ))}
        </ul>
      )}
    </section>
  )
}
