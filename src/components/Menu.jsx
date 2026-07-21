import { useEffect, useId, useRef, useState } from 'react'

/**
 * Small popover menu: a trigger button that opens an anchored panel.
 * Closes on outside click, Escape, or blur-out. Lighter than Modal — no
 * focus trap or scroll lock, since a menu doesn't take over the page.
 *
 * @param {(props: { open: boolean, toggle: () => void, ref: React.Ref }) => React.ReactNode} trigger
 * @param {React.ReactNode} children  menu content, typically <button role="menuitem"> rows
 * @param {'start'|'end'} align  which edge of the trigger the panel hangs from
 */
export default function Menu({ trigger, children, align = 'end', label }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    function onPointerDown(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="menu" ref={rootRef}>
      {trigger({
        open,
        toggle: () => setOpen((o) => !o),
        ref: triggerRef,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
      })}
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={`menu__panel menu__panel--${align}`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  )
}
