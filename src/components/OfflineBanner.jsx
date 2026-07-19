import { useEffect, useState } from 'react'

/**
 * Persistent banner shown whenever the browser loses connectivity.
 *
 * UX principle — "visibility of system status": if the network is down, say so
 * once at the top of the page rather than letting every action fail with its
 * own confusing error. It disappears by itself when the connection returns.
 */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' && navigator.onLine === false,
  )

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!offline) return null

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <span aria-hidden="true">📡</span>
      You&apos;re offline — changes can&apos;t be saved until the connection returns.
    </div>
  )
}
