import { useEffect, useRef } from 'react'

/**
 * Accessible modal shell.
 *
 * Implements the dialog behaviours users expect and screen readers require:
 *  - Escape closes it.
 *  - Focus moves into the dialog on open and is restored to the trigger on
 *    close, so keyboard users don't get dumped back at the top of the page.
 *  - Tab is trapped inside while open (a dialog you can tab out of behind is
 *    disorienting and lets you interact with hidden controls).
 *  - Background scrolling is locked.
 *  - Labelled via aria-labelledby so the title is announced on open.
 *
 * @param {'center'|'right'} [placement='center']  'right' renders a full-height
 *   drawer anchored to the right edge instead of a centered dialog (see
 *   .modal--right in Portal.css) — same a11y behavior either way.
 */
export default function Modal({ titleId, label, onClose, children, placement = 'center' }) {
  const ref = useRef(null)
  const restoreTo = useRef(null)

  useEffect(() => {
    restoreTo.current = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Focus the first sensible control inside the dialog.
    const focusables = () =>
      ref.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? []
    const first = focusables()[0]
    if (first) first.focus()
    else ref.current?.focus()

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = Array.from(focusables()).filter((el) => !el.disabled)
      if (items.length === 0) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      // Return focus where the user left it.
      if (restoreTo.current instanceof HTMLElement) restoreTo.current.focus()
    }
  }, [onClose])

  return (
    <div
      className={`modal-overlay${placement === 'right' ? ' modal-overlay--right' : ''}`}
      onMouseDown={onClose}
    >
      <div
        className={`modal${placement === 'right' ? ' modal--right' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={titleId ? undefined : label}
        tabIndex={-1}
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
