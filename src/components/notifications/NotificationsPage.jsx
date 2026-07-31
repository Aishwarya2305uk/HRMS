import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon'
import { announcements as announcementsApi } from '../../lib/hrms'
import { haptic } from '../../lib/haptics'
import ComposeAnnouncementForm from './ComposeAnnouncementForm'
import NotificationsFeed from './NotificationsFeed'

/**
 * Dedicated Notifications section — the sidebar's full-page counterpart to
 * the topbar bell's drawer (NotificationsPanel). Same shared feed and
 * mark-all-read-on-open behavior; the composer opens in place of the feed,
 * mirroring the drawer's back-button flow.
 */
export default function NotificationsPage({
  query,
  onMarkedRead,
  canCompose,
  onCreated,
  onRemoved,
  approvalsPending,
  myPendingLeaves,
  typeLabels,
  currentUserId,
  role,
  onViewApprovals,
  onViewLeaves,
}) {
  const [composing, setComposing] = useState(false)
  const markedRef = useRef(false)

  useEffect(() => {
    if (markedRef.current) return
    markedRef.current = true
    announcementsApi.markAllRead().then(onMarkedRead).catch(() => {})
  }, [onMarkedRead])

  return (
    <section className="card notif-page pop" style={{ '--d': '60ms' }}>
      <div className="attendance__head">
        <h2>
          {composing ? (
            <>
              <button
                type="button"
                className="icon-btn sm"
                onClick={() => setComposing(false)}
                aria-label="Back to notifications"
              >
                <Icon name="chevronLeft" size={16} />
              </button>
              New announcement
            </>
          ) : (
            'Notifications'
          )}
        </h2>
        {!composing && canCompose && (
          <button
            type="button"
            className="btn-tactile primary sm"
            onClick={() => { haptic('light'); setComposing(true) }}
          >
            <Icon name="plus" size={15} />
            New announcement
          </button>
        )}
      </div>

      {composing ? (
        <ComposeAnnouncementForm
          onCancel={() => setComposing(false)}
          onCreated={(a) => { onCreated(a); setComposing(false) }}
        />
      ) : (
        <div className="notif-page__body">
          <NotificationsFeed
            query={query}
            onRemoved={onRemoved}
            approvalsPending={approvalsPending}
            myPendingLeaves={myPendingLeaves}
            typeLabels={typeLabels}
            currentUserId={currentUserId}
            role={role}
            onViewApprovals={onViewApprovals}
            onViewLeaves={onViewLeaves}
          />
        </div>
      )}
    </section>
  )
}
