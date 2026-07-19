import { useToast } from '../context/ToastContext'

const ICON = { success: '✓', error: '!', info: 'i' }

/**
 * Renders the toast stack.
 *
 * Accessibility notes:
 *  - The container is a live region so new messages are announced without
 *    stealing focus.
 *  - Errors use role="alert" (assertive) because they interrupt a task;
 *    confirmations use role="status" (polite) so they don't cut off a reader.
 *  - Every toast has a labelled dismiss control — nothing is mouse-only or
 *    time-limited beyond recovery.
 */
export default function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <div className="toaster" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.tone}`}
          role={t.tone === 'error' ? 'alert' : 'status'}
        >
          <span className={`toast__icon toast__icon--${t.tone}`} aria-hidden="true">
            {ICON[t.tone] ?? ICON.info}
          </span>
          <p className="toast__msg">{t.message}</p>
          {t.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                t.action.onClick()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className="toast__close"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
