import { useMemo, useState } from 'react'
import { useSessionState } from '../lib/useSessionState'
import { EmptyState } from './States'
import { AnnouncementItem } from './notifications/NotificationsFeed'
import ComposeAnnouncementForm from './notifications/ComposeAnnouncementForm'
import TeamsManager from './TeamsManager'

const FILTER_LABEL = { all: 'All', announcement: 'Announcements', urgent: 'Urgent' }

/**
 * Dedicated Announcements page for admins/managers: post new messages and
 * review/retract everything already sent. The right-side drawer only shows
 * what's addressed to the viewer as a recipient; this shows everything the
 * viewer is allowed to manage (admin: company-wide, manager: their own
 * posts) — fed by GET /announcements/sent instead of GET /announcements.
 * @param {Array}    props.items         from /announcements/sent
 * @param {Function} props.onCreated     appends a newly-posted item to shared state
 * @param {Function} props.onRemoved     removes a retracted item from shared state
 * @param {string}   props.currentUserId
 * @param {string}   props.role
 * @param {string}   [props.searchQuery] filters by title/body/author
 */
export default function AllAnnouncements({ items, onCreated, onRemoved, currentUserId, role, searchQuery = '' }) {
  // Survives a refresh (per tab) so you come back to the same lens.
  const [filter, setFilter] = useSessionState('ui.allAnnouncements.filter', 'all')
  const [composeKey, setComposeKey] = useState(0)

  const rows = useMemo(() => {
    const byType = filter === 'all' ? items : items.filter((a) => a.type === filter)
    const q = searchQuery.trim().toLowerCase()
    if (!q) return byType
    return byType.filter((a) => [a.title, a.body, a.authorName].some((f) => f?.toLowerCase().includes(q)))
  }, [items, filter, searchQuery])

  const counts = useMemo(() => {
    const c = { all: items.length, announcement: 0, urgent: 0 }
    for (const a of items) c[a.type]++
    return c
  }, [items])

  function canRemove(item) {
    return role === 'admin' || item.authorId === currentUserId
  }

  return (
    <div className="notif-manage">
      <TeamsManager />

      <section className="card pop" style={{ '--d': '80ms' }}>
        <div className="attendance__head">
          <h2>New announcement</h2>
        </div>
        <ComposeAnnouncementForm
          key={composeKey}
          cancelLabel="Clear form"
          onCancel={() => setComposeKey((k) => k + 1)}
          onCreated={(a) => { onCreated(a); setComposeKey((k) => k + 1) }}
        />
      </section>

      <section className="card pop" style={{ '--d': '160ms' }}>
        <div className="attendance__head">
          <h2>{role === 'admin' ? 'All announcements' : 'Your announcements'}</h2>
          <div className="seg">
            {Object.keys(FILTER_LABEL).map((s) => (
              <button
                key={s}
                className={`seg__btn${filter === s ? ' is-active' : ''}`}
                onClick={() => setFilter(s)}
              >
                {FILTER_LABEL[s]} <b>{counts[s]}</b>
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon="megaphone"
            title={searchQuery.trim() ? 'No matches' : filter === 'all' ? 'Nothing posted yet' : `No ${filter} messages`}
            message={
              searchQuery.trim()
                ? `Nothing matches "${searchQuery.trim()}".`
                : filter === 'all'
                  ? 'Whatever you post above shows up here so you can track and retract it.'
                  : 'Try a different filter to see other messages.'
            }
          />
        ) : (
          <ul className="notif-list">
            {rows.map((a) => (
              <AnnouncementItem key={a.id} item={a} canRemove={canRemove(a)} onRemove={onRemoved} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
