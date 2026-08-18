import { useMemo, useState } from 'react'
import Icon from '../Icon'
import { Skeleton, EmptyState, InlineError } from '../States'
import {
  formatDayGroup,
  formatRelativeTime,
  formatRequestWindow,
  formatTime,
  requestLabel,
} from '../../lib/format'
import { announcements as announcementsApi } from '../../lib/hrms'
import { haptic } from '../../lib/haptics'

/** How this announcement's audience reads in plain English. */
export function audienceLabel(item) {
  if (item.audienceScope === 'all') return 'Everyone'
  if (item.audienceScope === 'role') return `All ${item.audienceRole}s`
  if (item.audienceScope === 'group') return item.audienceGroupName ? `${item.audienceGroupName} team` : 'A project team'
  return item.audienceRootName ? `${item.audienceRootName}'s team` : 'Team'
}

/**
 * What each row IS, now that the feed is ordered by time instead of grouped
 * under a category heading. The heading used to carry this ("Awaiting your
 * approval"), so without a per-row marker an approval request and your own
 * pending request would be indistinguishable.
 */
const KINDS = {
  urgent: { icon: 'alertTriangle', label: 'Urgent message', tone: 'urgent' },
  announcement: { icon: 'megaphone', label: 'Announcement' },
  approval: { icon: 'check', label: 'Awaiting your approval', tone: 'action' },
  mine: { icon: 'clock', label: 'Awaiting decision' },
  decision: { icon: 'bell', label: 'Update on your request' },
}

/** Per-source cap. The feed stays a summary — the "view all" links above it
 *  lead to the full queues — so one busy day can't bury everything else. */
const MAX_PER_SOURCE = 5

/** Stable "nothing loaded yet" identity, so the grouping memo below doesn't
 *  see a fresh array — and rebuild every group — on each render. */
const EMPTY = []

/**
 * The "what this is / when" line at the top of every row in the day-grouped
 * feed. The day header already says which day, so this shows the clock time —
 * together they read as "Today · 09:41 AM" without repeating the date on
 * every row.
 */
function KindLine({ kind, at }) {
  const meta = KINDS[kind]
  if (!meta) return null
  return (
    <div className="notif-item__kind">
      <span className={`notif-item__kind-icon${meta.tone ? ` is-${meta.tone}` : ''}`}>
        <Icon name={meta.icon} size={12} />
      </span>
      <span className="notif-item__kind-label">{meta.label}</span>
      {at && <time dateTime={at}>{formatTime(at)}</time>}
    </div>
  )
}

/**
 * One announcement/urgent-message card — shared by the drawer, the
 * Notifications page, and the Announcements management page.
 *
 * `kind` is passed only by the day-grouped feed: it swaps the head's relative
 * timestamp ("2h ago") for the kind line above, since a row sitting under a
 * "Today" header doesn't also need to be told it's recent. The Announcements
 * management page passes nothing and keeps the original layout.
 */
export function AnnouncementItem({ item, canRemove, onRemove, kind }) {
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
      {kind && <KindLine kind={kind} at={item.createdAt} />}
      <div className="notif-item__head">
        <strong>{item.title}</strong>
        {!kind && <time>{formatRelativeTime(item.createdAt)}</time>}
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

const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }

/** One leave/WFH request row — pending queues and decisions. `at` is the
 *  moment the row is filed under, which is the request time for a pending
 *  item and the DECISION time for a decided one. */
function LeaveRow({ leave, typeLabels, kind, at, showName }) {
  const label = requestLabel(leave, typeLabels)
  return (
    <li className="notif-item notif-item--pending">
      <KindLine kind={kind} at={at} />
      <div className="notif-item__head">
        <strong>{showName ? leave.employeeName : label}</strong>
        <span className={`status ${leave.status}`}>{STATUS_LABEL[leave.status] ?? leave.status}</span>
      </div>
      <p className="notif-item__body">
        {showName && <>{label} · </>}
        {formatRequestWindow(leave)}
      </p>
    </li>
  )
}

/**
 * The notification feed itself — urgent admin messages plus work items
 * (approvals queue for managers/admins, own pending requests and decisions
 * on those requests; upcoming time off lives on the Leaves tab instead).
 * Pure rendering, shared by the topbar drawer (NotificationsPanel) and the
 * dedicated sidebar page (NotificationsPage); marking-as-read stays with
 * those surfaces.
 *
 * `showAnnouncements` keeps regular announcements in the drawer's quick
 * glance, while the full page leaves them to the dedicated Announcements
 * section (that page is for reading/managing them — this one is work).
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
  showAnnouncements = true,
  recentDecisions = [],
}) {
  const items = query.data ?? EMPTY

  /**
   * Everything the feed can show, merged into ONE chronological list and cut
   * into day groups — the ClickUp-style inbox: newest first, under "Today",
   * "Yesterday", then weekday names.
   *
   * Each source contributes the timestamp it should be filed under, which is
   * not always its creation time: a decision belongs to the day it was
   * DECIDED, not the day the request was raised, or a leave approved this
   * morning would surface under whatever day it was applied for.
   */
  const groups = useMemo(() => {
    const entries = [
      ...items
        .filter((a) => (a.type === 'urgent' ? true : showAnnouncements))
        .map((a) => ({
          key: `a-${a.id}`,
          kind: a.type === 'urgent' ? 'urgent' : 'announcement',
          at: a.createdAt,
          announcement: a,
        })),
      ...approvalsPending.slice(0, MAX_PER_SOURCE).map((l) => ({
        key: `p-${l.id}`,
        kind: 'approval',
        at: l.createdAt,
        leave: l,
        showName: true,
      })),
      ...myPendingLeaves.slice(0, MAX_PER_SOURCE).map((l) => ({
        key: `m-${l.id}`,
        kind: 'mine',
        at: l.createdAt,
        leave: l,
      })),
      ...recentDecisions.slice(0, MAX_PER_SOURCE).map((l) => ({
        key: `d-${l.id}`,
        kind: 'decision',
        at: l.decidedAt,
        leave: l,
      })),
    ].filter((e) => e.at)

    entries.sort((a, b) => new Date(b.at) - new Date(a.at))

    // Consecutive runs, not a keyed bucket map: the list is already sorted
    // newest-first and the label is a monotonic function of the day, so equal
    // labels are always adjacent — and this keeps the groups themselves in
    // order without a second sort.
    const out = []
    for (const entry of entries) {
      const label = formatDayGroup(entry.at)
      const last = out[out.length - 1]
      if (last && last.label === label) last.entries.push(entry)
      else out.push({ label, entries: [entry] })
    }
    return out
  }, [items, showAnnouncements, approvalsPending, myPendingLeaves, recentDecisions])

  const isEmpty = !query.loading && !query.error && groups.length === 0

  function canRemove(item) {
    return role === 'admin' || item.authorId === currentUserId
  }

  // The category headings used to carry a "View all" link each. With the feed
  // ordered by time there are no category headings left, so the routes into
  // the full queues live here instead — and they also say how many are
  // waiting, which the capped rows below no longer imply.
  const jumps = [
    approvalsPending.length > 0 && {
      key: 'approvals',
      icon: 'check',
      label: `${approvalsPending.length} awaiting your approval`,
      onClick: onViewApprovals,
    },
    myPendingLeaves.length > 0 && {
      key: 'mine',
      icon: 'clock',
      label: `${myPendingLeaves.length} of your requests pending`,
      onClick: onViewLeaves,
    },
  ].filter(Boolean)

  // A whole-feed skeleton, not one scoped to the announcements query: rows
  // from every source are interleaved by time now, so rendering the work
  // items first would make announcements shuffle in among them a moment
  // later. An announcement ERROR still degrades gracefully — the banner shows
  // and the rest of the feed renders without them.
  if (query.loading && items.length === 0) return <Skeleton rows={4} />

  return (
    <>
      {query.error && items.length === 0 && (
        <InlineError onRetry={query.reload}>{query.error.message}</InlineError>
      )}

      {jumps.length > 0 && (
        <div className="notif-jump">
          {jumps.map((j) => (
            <button key={j.key} type="button" className="notif-jump__btn" onClick={j.onClick}>
              <Icon name={j.icon} size={13} />
              {j.label}
              {/* No chevronRight in the icon set — chevronLeft flipped, which
                  is what a right-pointing chevron is anyway. */}
              <Icon name="chevronLeft" size={13} className="notif-jump__caret" />
            </button>
          ))}
        </div>
      )}

      {groups.map((group) => (
        <section className="notif-day" key={group.label}>
          <div className="notif-day__head">
            <h3>{group.label}</h3>
            <span className="notif-day__rule" aria-hidden="true" />
          </div>
          <ul className="notif-list">
            {group.entries.map((entry) =>
              entry.announcement ? (
                <AnnouncementItem
                  key={entry.key}
                  item={entry.announcement}
                  kind={entry.kind}
                  canRemove={canRemove(entry.announcement)}
                  onRemove={onRemoved}
                />
              ) : (
                <LeaveRow
                  key={entry.key}
                  leave={entry.leave}
                  typeLabels={typeLabels}
                  kind={entry.kind}
                  at={entry.at}
                  showName={entry.showName}
                />
              ),
            )}
          </ul>
        </section>
      ))}

      {isEmpty && (
        <EmptyState
          icon="bell"
          title="You're all caught up"
          message={
            showAnnouncements
              ? 'No announcements or pending items right now.'
              : 'No pending work, request updates or admin messages right now.'
          }
        />
      )}
    </>
  )
}
