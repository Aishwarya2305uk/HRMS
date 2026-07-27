import { useMemo, useState } from 'react'
import { haptic } from '../lib/haptics'
import Icon from './Icon'
import { EmptyState } from './States'

const ROLE_TINT = { admin: 'indigo', manager: 'blue', employee: 'green' }

const ACTIVITY_LABEL = { online: 'Online', idle: 'Idle', offline: 'Offline' }

const ZOOM_MIN = 0.6
const ZOOM_MAX = 1.4
const ZOOM_STEP = 0.1

/** Presence dot — green online, amber idle (on a break), grey offline. */
function ActivityDot({ state = 'offline' }) {
  const label = ACTIVITY_LABEL[state] ?? ACTIVITY_LABEL.offline
  return (
    <span
      className={`status-dot status-dot--${ACTIVITY_LABEL[state] ? state : 'offline'}`}
      role="img"
      aria-label={label}
      title={label}
    />
  )
}

/**
 * One box in the graphical chart, connected to its children by CSS-drawn
 * elbow lines (see .org-chart rules) — styled after Microsoft Teams' org
 * structure diagram: admins/managers render as a solid "unit" box (their
 * role tint), employees render as a header+body "leaf" card. Recursive;
 * always fully expanded (the whole point is seeing the shape of the company
 * at a glance).
 */
function OrgChartNode({ node, currentUserId }) {
  const hasReports = node.reports?.length > 0
  const isYou = node.id === currentUserId
  const tint = ROLE_TINT[node.role] || 'indigo'
  const isUnit = node.role === 'admin' || node.role === 'manager'

  return (
    <li>
      <div className={`org-chart-card org-chart-card--${isUnit ? 'unit' : 'leaf'} tint-${tint}${isYou ? ' is-you' : ''}`}>
        {isUnit ? (
          <>
            <span className="org-chart-card__avatar">
              <span className={`avatar sm tint-${tint}`} aria-hidden="true">
                {node.name?.[0] ?? '?'}
              </span>
              <ActivityDot state={node.activity} />
              {hasReports && (
                <span className="org-chart-card__badge" title={`${node.reports.length} direct report(s)`}>
                  {node.reports.length}
                </span>
              )}
            </span>
            <div className="org-chart-card__text">
              <strong>
                {node.name}
                {isYou && <span className="you-tag">You</span>}
              </strong>
              <em>{node.designation || node.role}</em>
            </div>
          </>
        ) : (
          <>
            <div className="org-chart-card__head">
              <ActivityDot state={node.activity} />
              {node.name}
              {isYou && <span className="you-tag">You</span>}
            </div>
            <div className="org-chart-card__body">
              {node.designation && <span className="org-chart-card__row">{node.designation}</span>}
              {node.department && <span className="org-chart-card__row">{node.department}</span>}
              {!node.designation && !node.department && (
                <span className="org-chart-card__row org-chart-card__row--muted">Employee</span>
              )}
            </div>
          </>
        )}
      </div>

      {hasReports && (
        <ul>
          {node.reports.map((child) => (
            <OrgChartNode key={child.id} node={child} currentUserId={currentUserId} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Graphical chart + zoom controls, scrollable when it's wider than the card. */
function OrgChart({ roots, currentUserId }) {
  const [zoom, setZoom] = useState(1)
  const zoomBy = (delta) =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 10) / 10)))

  return (
    <div className="org-chart-wrap">
      <div className="org-chart-zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => { haptic('light'); setZoom(1) }} aria-label="Reset zoom" title="Reset zoom">
          <Icon name="refreshCw" size={15} />
        </button>
        <button type="button" onClick={() => { haptic('light'); zoomBy(ZOOM_STEP) }} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in" title="Zoom in">
          <Icon name="zoomIn" size={15} />
        </button>
        <button type="button" onClick={() => { haptic('light'); zoomBy(-ZOOM_STEP) }} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out" title="Zoom out">
          <Icon name="zoomOut" size={15} />
        </button>
      </div>
      <div className="org-chart-scroll">
        <ul className="org-chart" style={{ transform: `scale(${zoom})` }}>
          {roots.map((r) => (
            <OrgChartNode key={r.id} node={r} currentUserId={currentUserId} />
          ))}
        </ul>
      </div>
    </div>
  )
}

/** One row + its (collapsible) reports in the indented outline — the "List" view. */
function OrgOutlineNode({ node, depth = 0, currentUserId }) {
  const [open, setOpen] = useState(depth < 2) // expand the top couple of levels
  const hasReports = node.reports?.length > 0
  const isYou = node.id === currentUserId

  return (
    <li className="org-outline-node">
      <div className={`org-card${isYou ? ' is-you' : ''}`}>
        <span className="org-avatar">
          <span className={`avatar sm tint-${ROLE_TINT[node.role] || 'indigo'}`} aria-hidden="true">
            {node.name?.[0] ?? '?'}
          </span>
          <ActivityDot state={node.activity} />
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
        <ul className="org-outline-children">
          {node.reports.map((child) => (
            <OrgOutlineNode key={child.id} node={child} depth={depth + 1} currentUserId={currentUserId} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Depth-first walk of the tree into a flat, alphabetical roster for search results. */
function flatten(roots) {
  const rows = []
  const walk = (nodes, managerName) => {
    for (const n of nodes) {
      rows.push({ ...n, managerName })
      if (n.reports?.length) walk(n.reports, n.name)
    }
  }
  walk(roots ?? [], null)
  return rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

/** Flat roster shown while searching — same people, sorted by name, with who they report to. */
function OrgSearchResults({ roots, currentUserId, searchQuery }) {
  const rows = useMemo(() => {
    const all = flatten(roots)
    const q = searchQuery?.trim().toLowerCase()
    if (!q) return all
    return all.filter((p) =>
      [p.name, p.designation, p.department].some((f) => f?.toLowerCase().includes(q)),
    )
  }, [roots, searchQuery])

  if (searchQuery?.trim() && rows.length === 0) {
    return (
      <EmptyState
        icon="tree"
        title="No matches"
        message={`Nobody matches "${searchQuery.trim()}".`}
      />
    )
  }

  return (
    <ul className="org-list">
      {rows.map((p) => (
        <li key={p.id} className={`org-card${p.id === currentUserId ? ' is-you' : ''}`}>
          <span className="org-avatar">
            <span className={`avatar sm tint-${ROLE_TINT[p.role] || 'indigo'}`} aria-hidden="true">
              {p.name?.[0] ?? '?'}
            </span>
            <ActivityDot state={p.activity} />
          </span>
          <div className="org-card__text">
            <strong>
              {p.name}
              {p.id === currentUserId && <span className="you-tag">You</span>}
            </strong>
            <em>{p.designation || p.role}{p.department ? ` · ${p.department}` : ''}</em>
          </div>
          <span className="org-list__manager">
            {p.managerName ? `Reports to ${p.managerName}` : 'No manager'}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Company reporting tree, built from the manager self-reference. Visible to all
 * roles. Two ways to browse it, plus a flat search fallback:
 *  - Tree: a graphical, Teams-style chart — cards connected by elbow lines.
 *  - List: the same hierarchy as a collapsible indented outline.
 * @param {Array}  props.roots          top-level nodes from /employees/org-tree
 * @param {string} props.currentUserId  to highlight "You"
 * @param {string} [props.searchQuery]  filters the roster; forces the flat search view while active
 */
export default function OrgTree({ roots, currentUserId, searchQuery = '' }) {
  const [view, setView] = useState('tree')
  const isEmpty = !roots || roots.length === 0
  const isSearching = Boolean(searchQuery.trim())
  const effectiveView = isSearching ? 'list' : view

  return (
    <section className="card pop" style={{ '--d': '120ms' }}>
      <div className="attendance__head">
        <h2>Organization</h2>
        {!isEmpty && (
          <div className="seg" role="group" aria-label="View">
            {[
              { key: 'tree', icon: 'tree', label: 'Tree' },
              { key: 'list', icon: 'list', label: 'List' },
            ].map((v) => (
              <button
                key={v.key}
                className={`seg__btn seg__btn--icon${effectiveView === v.key ? ' is-active' : ''}`}
                onClick={() => { haptic('light'); setView(v.key) }}
                disabled={isSearching && v.key === 'tree'}
                title={isSearching && v.key === 'tree' ? 'Clear search to browse the tree' : undefined}
                aria-pressed={effectiveView === v.key}
              >
                <Icon name={v.icon} size={15} />
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!isEmpty && (
        <div className="org-legend">
          <span><span className="status-dot status-dot--online" /> Online</span>
          <span><span className="status-dot status-dot--idle" /> Idle</span>
          <span><span className="status-dot status-dot--offline" /> Offline</span>
        </div>
      )}

      {isEmpty ? (
        <EmptyState
          icon="tree"
          title="No reporting structure yet"
          message="The tree builds itself as an admin adds people and assigns their managers."
        />
      ) : isSearching ? (
        <OrgSearchResults roots={roots} currentUserId={currentUserId} searchQuery={searchQuery} />
      ) : view === 'tree' ? (
        <OrgChart roots={roots} currentUserId={currentUserId} />
      ) : (
        <ul className="org-outline">
          {roots.map((r) => (
            <OrgOutlineNode key={r.id} node={r} currentUserId={currentUserId} />
          ))}
        </ul>
      )}
    </section>
  )
}
