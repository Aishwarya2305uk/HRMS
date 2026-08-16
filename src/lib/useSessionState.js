import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

const PREFIX = 'hrms.session.'

const storageKey = (userId, key) => `${PREFIX}${userId ?? 'anon'}.${key}`

function readStored(fullKey, initial) {
  const fallback = () => (typeof initial === 'function' ? initial() : initial)
  try {
    const raw = sessionStorage.getItem(fullKey)
    return raw === null ? fallback() : JSON.parse(raw)
  } catch {
    return fallback()
  }
}

function writeStored(fullKey, value) {
  try {
    if (value === undefined) sessionStorage.removeItem(fullKey)
    else sessionStorage.setItem(fullKey, JSON.stringify(value))
  } catch {
    // Storage disabled or full — the state still lives in React; it just
    // won't survive a refresh.
  }
}

/**
 * Drop-in for useState whose value survives a page refresh.
 *
 * Backed by sessionStorage — scoped to this browser tab and gone when the
 * tab closes, so a half-filled form comes back after a reload but never
 * haunts a later visit — and namespaced by the signed-in user's id, so two
 * accounts sharing a browser never see each other's drafts. Values must be
 * JSON-serialisable (no Sets, Files, Dates); anything that isn't should stay
 * in plain useState.
 *
 * `key` may change over the component's life (e.g. include a record id): the
 * new key's stored value is adopted in the same render, so no render ever
 * shows — or saves — the previous key's value under the new one.
 *
 * @template T
 * @param {string} key                stable name for the purpose, e.g. 'draft.applyLeave.reason'
 * @param {T | (() => T)} initial     as useState's initial value
 * @returns {[T, (next: T | ((prev: T) => T)) => void]}
 */
export function useSessionState(key, initial) {
  const { user } = useAuth()
  const fullKey = storageKey(user?.id, key)
  const [slot, setSlot] = useState(() => ({ key: fullKey, value: readStored(fullKey, initial) }))

  // Key changed (another user signed in, or a different record) → adopt that
  // key's stored value right now, in render — React's documented pattern for
  // adjusting state when a prop changes.
  let current = slot
  if (slot.key !== fullKey) {
    current = { key: fullKey, value: readStored(fullKey, initial) }
    setSlot(current)
  }

  const setValue = useCallback((next) => {
    setSlot((s) => ({ key: s.key, value: typeof next === 'function' ? next(s.value) : next }))
  }, [])

  useEffect(() => {
    writeStored(current.key, current.value)
  }, [current.key, current.value])

  return [current.value, setValue]
}

/** Forget everything this hook stored for the tab — called on sign-out. */
export function clearSessionState() {
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith(PREFIX)) sessionStorage.removeItem(k)
    }
  } catch {
    // storage unavailable — nothing to clear
  }
}
