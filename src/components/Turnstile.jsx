import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

/** Public by design — a Turnstile site key is meant to be embedded in the page. */
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY

const SCRIPT_ID = 'turnstile-api-script'
/** Cloudflare's documented hook for render=explicit: the script's own `load`
 *  event fires once the file is fetched, but `window.turnstile` isn't
 *  guaranteed ready until the `onload=` query-param callback runs — same
 *  contract Google's reCAPTCHA had, so the loader keeps the same shape:
 *  https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ */
const CALLBACK_NAME = '__hrmsTurnstileOnLoad'
/** Module-level so every mount shares one script load, not one per instance. */
let scriptPromise = null

function loadTurnstileScript() {
  if (window.turnstile?.render) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    window[CALLBACK_NAME] = () => resolve(window.turnstile)
    if (document.getElementById(SCRIPT_ID)) return // callback above still fires once Cloudflare's script calls it

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?onload=${CALLBACK_NAME}&render=explicit`
    script.async = true
    script.defer = true
    script.onerror = () => reject(new Error('Could not load the CAPTCHA. Check your connection.'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

/**
 * Cloudflare Turnstile widget (replaces Google reCAPTCHA, whose verification
 * kept failing on the live deployment).
 *
 * Renders nothing at all when VITE_TURNSTILE_SITE_KEY isn't set at build
 * time — LoginForm treats that as "CAPTCHA isn't required" and skips it
 * entirely, mirroring the backend's matching skip when TURNSTILE_SECRET_KEY
 * is unconfigured (server/routes/auth.js). Configure both to turn it on.
 *
 * Imperative `reset()` (via ref) matters because a completed token is
 * single-use: after a failed login attempt the widget must be reset before
 * the user can complete it again, not just re-rendered.
 *
 * @param {(token: string|null) => void} onChange
 * @param {(message: string) => void} [onError]
 */
const Turnstile = forwardRef(function Turnstile({ onChange, onError }, ref) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetIdRef.current != null) window.turnstile?.reset(widgetIdRef.current)
    },
  }))

  useEffect(() => {
    if (!SITE_KEY) return
    let cancelled = false

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !containerRef.current || widgetIdRef.current != null) return
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onChange(token),
          'expired-callback': () => onChange(null),
          'error-callback': () => {
            onError?.('Could not verify — please retry.')
            return true // tell Turnstile the error was handled (no console spam)
          },
        })
      })
      .catch((err) => onError?.(err.message))

    return () => {
      cancelled = true
    }
  }, [onChange, onError])

  if (!SITE_KEY) return null
  return <div ref={containerRef} className="captcha-widget" />
})

export default Turnstile
