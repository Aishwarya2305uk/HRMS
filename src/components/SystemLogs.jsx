import { haptic } from '../lib/haptics'
import { useSessionState } from '../lib/useSessionState'
import Icon from './Icon'
import ActivityLogs from './logs/ActivityLogs'
import AdvancedLogs from './logs/AdvancedLogs'

/**
 * The admin Logs page: two tabs over two genuinely different audit trails.
 *
 *   Activity Logs (default) — what PEOPLE did, in plain language. Written by
 *     the routes that perform each action (server/services/activityLog.js),
 *     one entry per real action.
 *   Advanced Logs           — what the SYSTEM did. One row per API call, from
 *     middleware/requestLog.js. Unchanged; for developers and technical admins.
 *
 * They are not two views of one dataset. A single action ("approve this
 * leave") produces several API calls, only one of which is the action — so the
 * human trail can't be derived from the technical one, and the technical one
 * can't be simplified into the human one.
 *
 * Both tabs stay MOUNTED once opened is deliberately NOT the behaviour: each
 * owns its fetch and filter state, and switching tabs re-reads. Keeping a
 * stale audit table alive in the background would be worse than a refetch.
 */
const TABS = [
  { key: 'activity', label: 'Activity Logs', icon: 'users' },
  { key: 'advanced', label: 'Advanced Logs', icon: 'activity' },
]

export default function SystemLogs() {
  // Activity is the default; the choice survives a refresh, per tab, like
  // every other lens in the app.
  const [tab, setTab] = useSessionState('ui.logs.tab', 'activity')
  // A stored value from an older build (or a hand-edited key) shouldn't render
  // a blank page — anything unrecognised falls back to the default tab.
  const active = TABS.some((t) => t.key === tab) ? tab : 'activity'

  function select(key) {
    if (key === active) return
    haptic('light')
    setTab(key)
  }

  return (
    <section className="card pop" style={{ '--d': '120ms' }}>
      <div className="logs__head">
        {/* Matches the sidebar/topbar label — the page keeps its name, the
            tabs split what's inside it. */}
        <h2>System Logs</h2>
        <div className="seg logs__tabs" role="tablist" aria-label="Log type">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`logs-tab-${t.key}`}
              aria-selected={active === t.key}
              aria-controls={`logs-panel-${t.key}`}
              className={`seg__btn${active === t.key ? ' is-active' : ''}`}
              onClick={() => select(t.key)}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`logs-panel-${active}`}
        aria-labelledby={`logs-tab-${active}`}
        // Remounts on tab change, which is what resets each panel's fetch.
        key={active}
      >
        {active === 'activity' ? <ActivityLogs /> : <AdvancedLogs />}
      </div>
    </section>
  )
}
