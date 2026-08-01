import { useEffect, useRef } from 'react'
import { announcements as announcementsApi } from '../../lib/hrms'
import NotificationsFeed from './NotificationsFeed'

/**
 * Dedicated Notifications section — the sidebar's full-page counterpart to
 * the topbar bell's drawer (NotificationsPanel). Work notifications only:
 * approvals waiting on you, your requests (pending and decided), upcoming
 * time off and urgent admin messages. Regular announcements — and composing
 * them — live on the dedicated Announcements page instead.
 */
export default function NotificationsPage({
  query,
  onMarkedRead,
  onRemoved,
  approvalsPending,
  myPendingLeaves,
  recentDecisions,
  upcoming,
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
          upcoming={upcoming}
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
