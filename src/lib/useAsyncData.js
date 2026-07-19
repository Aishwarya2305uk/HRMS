import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Loads async data with the three outcomes every view needs: loading, error and
 * data — plus a reload() for retry.
 *
 * Written because the app previously did `promise.catch(() => {})` in six
 * places: when a request failed the user saw an empty dashboard with no
 * explanation and no way to recover. Silent failure is the worst possible
 * feedback, so failures are now first-class state.
 *
 * @param {() => Promise<any>} fetcher
 * @param {object}  [opts]
 * @param {boolean} [opts.enabled=true]  defer until a section is actually opened
 * @param {any}     [opts.initial=null]
 */
export function useAsyncData(fetcher, { enabled = true, initial = null } = {}) {
  const [data, setData] = useState(initial)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(Boolean(enabled))
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  // Guards against a slow earlier response overwriting a newer one.
  const runIdRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(async () => {
    const runId = ++runIdRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await fetcherRef.current()
      if (!mountedRef.current || runId !== runIdRef.current) return
      setData(result)
    } catch (err) {
      if (!mountedRef.current || runId !== runIdRef.current) return
      setError(err)
    } finally {
      if (mountedRef.current && runId === runIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    load()
  }, [enabled, load])

  return { data, setData, error, loading, reload: load }
}
