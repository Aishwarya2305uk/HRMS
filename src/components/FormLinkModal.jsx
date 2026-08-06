import Modal from './Modal'
import Icon from './Icon'

/**
 * In-app popup for the sidebar's Feedback / HR Request options: embeds the
 * admin-configured external form (see Other Settings) in an iframe so people
 * can fill it without leaving the app. Some form providers refuse to render
 * inside an iframe (X-Frame-Options / frame-ancestors) — the "Open in new
 * tab" link in the header is the always-works fallback for those.
 */
export default function FormLinkModal({ title, url, onClose }) {
  return (
    <Modal titleId="form-link-title" onClose={onClose} className="modal--form-link">
      <div className="modal__head">
        <h2 id="form-link-title">{title}</h2>
        <div className="form-modal__tools">
          <a className="link-btn" href={url} target="_blank" rel="noopener noreferrer">
            <Icon name="externalLink" size={14} />
            Open in new tab
          </a>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>

      {/* Sandboxed: everything a hosted form needs, but the embedded page
          can't navigate or script the app itself. */}
      <iframe
        className="form-modal__frame"
        src={url}
        title={title}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
      />
      <p className="field-hint">If the form doesn’t load here, use “Open in new tab”.</p>
    </Modal>
  )
}
