import { useEffect, useRef } from 'react'
import { announcements as announcementsApi } from '../../lib/hrms'
import NotificationsFeed from './NotificationsFeed'

/**
 * Dedicated Notifications section — the sidebar's full-page counterpart to
 * the topbar bell's drawer (NotificationsPanel). Work notifications only:
 * approvals waiting on you, your requests (pending and decided) and urgent
 * admin messages. Regular announcements — and composing them — live on the
 * dedicated Announcements page; upcoming time off lives on the Leaves tab's
 * "Upcoming leaves" card.
 */
export default function NotificationsPage({
  query,
  onMarkedRead,
  onRemoved,
  approvalsPending,
  myPendingLeaves,
  recentDecisions,
  typeLabels,
  currentUserId,
  role,
  onViewApprovals,
  onViewLeaves,
}) {
  const markedRef = useRef(false)

  useEffect(() => {
    if (markedRef.current) return
    markedRef.current = true
    announcementsApi.markAllRead().then(onMarkedRead).catch(() => {})
  }, [onMarkedRead])

  return (
    <section className="card notif-page pop" style={{ '--d': '60ms' }}>
      <div className="attendance__head">
        <h2>Notifications</h2>
      </div>

      <div className="notif-page__body">
        <NotificationsFeed
          query={query}
          onRemoved={onRemoved}
          approvalsPending={approvalsPending}
          myPendingLeaves={myPendingLeaves}
          recentDecisions={recentDecisions}
          typeLabels={typeLabels}
          currentUserId={currentUserId}
          role={role}
          onViewApprovals={onViewApprovals}
          onViewLeaves={onViewLeaves}
          showAnnouncements={false}
        />
      </div>
    </section>
  )
}
