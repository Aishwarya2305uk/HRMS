import Icon from './Icon'

/**
 * The three states every data view needs besides "loaded with content":
 * loading, empty, and failed. Having one implementation of each keeps the
 * whole app consistent — the user learns the pattern once.
 */

/**
 * Skeleton placeholder. Mirrors the *shape* of the content that's coming so the
 * layout doesn't jump when it arrives (avoids cumulative layout shift), which
 * reads as faster than a spinner even at the same latency.
 */
export function Skeleton({ rows = 3, className = '' }) {
  return (
    <div className={`skeleton ${className}`} role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skeleton__row" key={i} style={{ '--i': `${i * 90}ms` }}>
          <div className="skeleton__avatar" />
          <div className="skeleton__lines">
            <div className="skeleton__line" />
            <div className="skeleton__line short" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** A full-card skeleton used while a whole section loads. */
export function SkeletonCard({ rows = 4 }) {
  return (
    <section className="card">
      <div className="skeleton__title" />
      <Skeleton rows={rows} />
    </section>
  )
}

/**
 * Empty state. Always says what the space is *for* and, where possible, offers
 * the action that fills it — an empty screen with no next step is a dead end.
 */
export function EmptyState({ icon = 'leaf', title, message, action }) {
  return (
    <div className="state state--empty">
      <span className="state__icon" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <h3 className="state__title">{title}</h3>
      {message && <p className="state__msg">{message}</p>}
      {action && (
        <button className="btn-tactile primary sm" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}

/**
 * Error state for a failed load.
 *
 * Deliberately distinguishes "we couldn't load this" from "there's nothing
 * here" — conflating them makes users think their data vanished. Always offers
 * a retry so a transient blip isn't a dead end.
 */
export function ErrorState({ message, onRetry, retrying }) {
  return (
    <div className="state state--error" role="alert">
      <span className="state__icon state__icon--error" aria-hidden="true">⚠️</span>
      <h3 className="state__title">Couldn&apos;t load this</h3>
      <p className="state__msg">{message || 'Something went wrong. Please try again.'}</p>
      {onRetry && (
        <button className="btn-tactile primary sm" onClick={onRetry} disabled={retrying}>
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
      )}
    </div>
  )
}

/** Inline error banner used inside cards and forms. */
export function InlineError({ children, onRetry }) {
  if (!children) return null
  return (
    <div className="inline-error" role="alert">
      <span aria-hidden="true">⚠️</span>
      <span>{children}</span>
      {onRetry && (
        <button type="button" className="inline-error__retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
