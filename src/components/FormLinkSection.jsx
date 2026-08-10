import Icon from './Icon'
import { EmptyState } from './States'

/**
 * In-app page for the sidebar's Feedback / HR Request sections: embeds the
 * admin-configured external form (see Other Settings) inline in the content
 * area — a full section, not a popup. Some form providers refuse to render
 * inside an iframe (X-Frame-Options / frame-ancestors) — the "Open in new
 * tab" link is the always-works fallback for those.
 */
export default function FormLinkSection({ title, url, noun, isAdmin, onOpenSettings }) {
  if (!url) {
    return (
      <section className="card pop" style={{ '--d': '120ms' }}>
        <EmptyState
          icon="externalLink"
          title={`No ${noun} is set up yet`}
          message={
            isAdmin
              ? 'Add the form link under Other Settings and it will appear here for everyone.'
              : 'Please ask an admin to set this up.'
          }
          action={isAdmin && onOpenSettings ? { label: 'Open Other Settings', onClick: onOpenSettings } : undefined}
        />
      </section>
    )
  }

  return (
    <section className="card pop" style={{ '--d': '120ms' }}>
      <div className="attendance__head">
        <h2>{title}</h2>
        <a className="link-btn" href={url} target="_blank" rel="noopener noreferrer">
          <Icon name="externalLink" size={14} />
          Open in new tab
        </a>
      </div>

      {/* Sandboxed: everything a hosted form needs, but the embedded page
          can't navigate or script the app itself. */}
      <iframe
        className="form-page__frame"
        src={url}
        title={title}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
      />
      <p className="field-hint">If the form doesn’t load here, use “Open in new tab”.</p>
    </section>
  )
}
