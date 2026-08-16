import { useEffect, useRef } from 'react'
import Modal from '../Modal'
import Icon from '../Icon'
import { announcements as announcementsApi } from '../../lib/hrms'
import { haptic } from '../../lib/haptics'
import { useSessionState } from '../../lib/useSessionState'
import ComposeAnnouncementForm from './ComposeAnnouncementForm'
import NotificationsFeed from './NotificationsFeed'

/**
 * Right-side notifications drawer — the topbar bell's quick-glance surface.
 * Renders the shared NotificationsFeed plus an in-place composer for
 * admins/managers; the sidebar's dedicated page (NotificationsPage) shows
 * the same feed as a full section.
 *
 * Marks everything currently visible as read once, on open — standard
 * notification-center UX, no per-item read toggle.
 */
export default function NotificationsPanel({
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
  onClose,
}) {
  // Survives a refresh alongside the drawer's own open flag (Portal) and the
  // compose form's fields, so a half-written announcement comes back intact.
  const [composing, setComposing] = useSessionState('ui.notificationsComposing', false)
  const markedRef = useRef(false)

  useEffect(() => {
    if (markedRef.current) return
    markedRef.current = true
    announcementsApi.markAllRead().then(onMarkedRead).catch(() => {})
  }, [onMarkedRead])

  return (
    <Modal placement="right" titleId="notif-title" onClose={onClose}>
      <div className="notif-drawer">
        <header className="notif-drawer__head">
          {composing && (
            <button
              type="button"
              className="icon-btn sm"
              onClick={() => setComposing(false)}
              aria-label="Back to notifications"
            >
              <Icon name="chevronLeft" size={16} />
            </button>
          )}
          <h2 id="notif-title">{composing ? 'New announcement' : 'Notifications'}</h2>
          <div className="notif-drawer__head-actions">
            {!composing && canCompose && (
              <button
                type="button"
                className="btn-tactile primary sm"
                onClick={() => { haptic('light'); setComposing(true) }}
              >
                <Icon name="plus" size={15} />
                New
              </button>
            )}
            <button className="icon-btn sm" onClick={onClose} aria-label="Close notifications">
              <Icon name="x" size={16} />
            </button>
          </div>
        </header>

        <div className="notif-drawer__body">
          {composing ? (
            <ComposeAnnouncementForm
              onCancel={() => setComposing(false)}
              onCreated={(a) => { onCreated(a); setComposing(false) }}
            />
          ) : (
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
          )}
        </div>
      </div>
    </Modal>
  )
}
