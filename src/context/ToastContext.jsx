import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

const ToastContext = createContext(null)

/** Errors stay longer than confirmations — they need more time to read/act on. */
const DURATION = { success: 3500, info: 4000, error: 6000 }
/** Never stack more than this; older ones drop off the top. */
const MAX_VISIBLE = 3

/**
 * Global, accessible notification system.
 *
 * UX principles applied:
 *  - Every action gets an acknowledgement, so the user is never left wondering
 *    whether something worked.
 *  - Confirmations auto-dismiss; errors linger and are always dismissible.
 *  - Announced to screen readers via the live region in <Toaster/>.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (message, tone = 'info', { action } = {}) => {
      if (!message) return null
      const id = ++idRef.current
      setToasts((prev) => [...prev, { id, message, tone, action }].slice(-MAX_VISIBLE))
      // Toasts carrying an action stay until dismissed — auto-hiding would rob
      // the user of the very thing they're meant to click.
      if (!action) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), DURATION[tone] ?? DURATION.info),
        )
      }
      return id
    },
    [dismiss],
  )

  const value = useMemo(
    () => ({
      toasts,
      dismiss,
      notify: push,
      success: (msg, opts) => push(msg, 'success', opts),
      error: (msg, opts) => push(msg, 'error', opts),
      info: (msg, opts) => push(msg, 'info', opts),
    }),
    [toasts, dismiss, push],
  )

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
