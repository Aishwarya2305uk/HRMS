import { useState } from 'react'
import Icon from '../Icon'
import { Skeleton, EmptyState, InlineError } from '../States'
import { formatRelativeTime, formatRequestWindow } from '../../lib/format'
import { announcements as announcementsApi } from '../../lib/hrms'
import { haptic } from '../../lib/haptics'

/** How this announcement's audience reads in plain English. */
export function audienceLabel(item) {
  if (item.audienceScope === 'all') return 'Everyone'
  if (item.audienceScope === 'role') return `All ${item.audienceRole}s`
  if (item.audienceScope === 'group') return item.audienceGroupName ? `${item.audienceGroupName} team` : 'A project team'
  return item.audienceRootName ? `${item.audienceRootName}'s team` : 'Team'
}

function NotifSection({ title, icon, tone, action, children }) {
  return (
    <section className={`notif-section${tone ? ` notif-section--${tone}` : ''}`}>
      <div className="notif-section__head">
        <h3>
          <Icon name={icon} size={15} /> {title}
        </h3>
        {action && (
          <button className="link-btn" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
      <ul className="notif-list">{children}</ul>
    </section>
  )
}

/** One announcement/urgent-message card — shared by the drawer, the
 *  Notifications page, and the Announcements management page. */
export function AnnouncementItem({ item, canRemove, onRemove }) {
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    haptic('light')
    try {
      await announcementsApi.remove(item.id)
      onRemove(item.id)
    } catch {
      setBusy(false)
    }
  }

  return (
    <li className={`notif-item${item.type === 'urgent' ? ' notif-item--urgent' : ''}`}>
      <div className="notif-item__head">
        <strong>{item.title}</strong>
        <time>{formatRelativeTime(item.createdAt)}</time>
      </div>
      <p className="notif-item__body">{item.body}</p>
      <div className="notif-item__meta">
        <span>{item.authorName ?? 'Someone'} · {audienceLabel(item)}</span>
        {canRemove && (
          <button
            type="button"
            className="notif-item__remove"
            onClick={remove}
            disabled={busy}
            aria-label={`Remove "${item.title}"`}
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
    </li>
  )
}

function PendingLeaveRow({ leave, typeLabels, showName }) {
  const label = leave.kind === 'wfh' ? 'Work from home' : typeLabels[leave.type] ?? leave.type
  return (
    <li className="notif-item notif-item--pending">
      <div className="notif-item__head">
        <strong>{showName ? leave.employeeName : label}</strong>
        <span className="status pending">Pending</span>
      </div>
      <p className="notif-item__body">
        {showName && <>{label} · </>}
        {formatRequestWindow(leave)}
      </p>
    </li>
  )
}

/**
 * The notification feed itself — urgent messages, announcements, and pending
 * work (approvals queue for managers/admins, own pending requests for
 * everyone). Pure rendering, shared by the topbar drawer (NotificationsPanel)
 * and the dedicated sidebar page (NotificationsPage); marking-as-read and
 * composing stay with those surfaces, which own their own chrome.
 */
export default function NotificationsFeed({
  query,
  onRemoved,
  approvalsPending,
  myPendingLeaves,
  typeLabels,
  currentUserId,
  role,
  onViewApprovals,
  onViewLeaves,
}) {
  const items = query.data ?? []
  const urgent = items.filter((a) => a.type === 'urgent')
  const normal = items.filter((a) => a.type !== 'urgent')
  const hasPendingWork = approvalsPending.length > 0 || myPendingLeaves.length > 0
  const isEmpty = !query.loading && !query.error && items.length === 0 && !hasPendingWork

  function canRemove(item) {
    return role === 'admin' || item.authorId === currentUserId
  }

  return (
    <>
      {/* Announcements/urgent: loading and error states are scoped to just
          this part, so a failed fetch never hides pending work below — that
          data comes from a separate, unrelated query. */}
      {query.loading && items.length === 0 ? (
        <Skeleton rows={3} />
      ) : query.error && items.length === 0 ? (
        <InlineError onRetry={query.reload}>{query.error.message}</InlineError>
      ) : (
        <>
          {urgent.length > 0 && (
            <NotifSection title="Urgent" icon="alertTriangle" tone="urgent">
              {urgent.map((a) => (
                <AnnouncementItem key={a.id} item={a} canRemove={canRemove(a)} onRemove={onRemoved} />
              ))}
            </NotifSection>
          )}

          {normal.length > 0 && (
            <NotifSection title="Announcements" icon="megaphone">
              {normal.map((a) => (
                <AnnouncementItem key={a.id} item={a} canRemove={canRemove(a)} onRemove={onRemoved} />
              ))}
            </NotifSection>
          )}
        </>
      )}

      {approvalsPending.length > 0 && (
        <NotifSection
          title="Awaiting your approval"
          icon="check"
          action={{ label: 'View all', onClick: onViewApprovals }}
        >
          {approvalsPending.slice(0, 5).map((l) => (
            <PendingLeaveRow key={l.id} leave={l} typeLabels={typeLabels} showName />
          ))}
        </NotifSection>
      )}

      {myPendingLeaves.length > 0 && (
        <NotifSection
          title="Your requests awaiting decision"
          icon="clock"
          action={{ label: 'View all', onClick: onViewLeaves }}
        >
          {myPendingLeaves.slice(0, 5).map((l) => (
            <PendingLeaveRow key={l.id} leave={l} typeLabels={typeLabels} />
          ))}
        </NotifSection>
      )}

      {isEmpty && (
        <EmptyState
          icon="bell"
          title="You're all caught up"
          message="No announcements or pending items right now."
        />
      )}
    </>
  )
}
