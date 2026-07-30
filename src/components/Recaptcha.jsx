import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

/** Public by design — a reCAPTCHA site key is meant to be embedded in the page. */
const SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY

const SCRIPT_ID = 'recaptcha-api-script'
/** Google's own documented hook for render=explicit: the script's *own*
 *  `load` event fires once the file is fetched and executed, but
 *  `grecaptcha.render` isn't actually attached until Google's further async
 *  setup finishes — calling it right after `load` throws "render is not a
 *  function". The `onload=` query param names a global callback Google
 *  invokes only once `grecaptcha` is fully ready, which is what render=explicit
 *  mode is documented to require: https://developers.google.com/recaptcha/docs/display#explicit_render */
const CALLBACK_NAME = '__hrmsRecaptchaOnLoad'
/** Module-level so every mount shares one script load, not one per instance. */
let scriptPromise = null

function loadRecaptchaScript() {
  if (window.grecaptcha?.render) return Promise.resolve(window.grecaptcha)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    window[CALLBACK_NAME] = () => resolve(window.grecaptcha)
    if (document.getElementById(SCRIPT_ID)) return // callback above still fires once Google's script calls it

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = `https://www.google.com/recaptcha/api.js?onload=${CALLBACK_NAME}&render=explicit`
    script.async = true
    script.defer = true
    script.onerror = () => reject(new Error('Could not load reCAPTCHA. Check your connection.'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

/**
 * Google reCAPTCHA v2 checkbox widget.
 *
 * Renders nothing at all when VITE_RECAPTCHA_SITE_KEY isn't set at build
 * time — LoginForm treats that as "CAPTCHA isn't required" and skips it
 * entirely, mirroring the backend's matching skip when RECAPTCHA_SECRET_KEY
 * is unconfigured (server/routes/auth.js). Configure both to turn it on.
 *
 * Imperative `reset()` (via ref) matters because a completed token is
 * single-use: after a failed login attempt the widget must be reset before
 * the user can complete it again, not just re-rendered.
 *
 * @param {(token: string|null) => void} onChange
 * @param {(message: string) => void} [onError]
 */
const Recaptcha = forwardRef(function Recaptcha({ onChange, onError }, ref) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetIdRef.current != null) window.grecaptcha?.reset(widgetIdRef.current)
    },
  }))

  useEffect(() => {
    if (!SITE_KEY) return
    let cancelled = false

    loadRecaptchaScript()
      .then((grecaptcha) => {
        if (cancelled || !containerRef.current || widgetIdRef.current != null) return
        widgetIdRef.current = grecaptcha.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onChange(token),
          'expired-callback': () => onChange(null),
          'error-callback': () => onError?.('Could not verify — please retry.'),
        })
      })
      .catch((err) => onError?.(err.message))

    return () => {
      cancelled = true
    }
  }, [onChange, onError])

  if (!SITE_KEY) return null
  return <div ref={containerRef} className="recaptcha-widget" />
})

export default Recaptcha
