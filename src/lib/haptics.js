/**
 * Lightweight haptic feedback via the Vibration API (mobile/supported devices).
 * No-ops silently where unsupported (most desktops) so it's always safe to call.
 */
const PATTERNS = {
  light: 8,
  medium: 14,
  heavy: 22,
  success: [10, 30, 18],
  warning: [12, 40, 12],
}

export function haptic(kind = 'light') {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return
  // Respect users who prefer reduced motion.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  navigator.vibrate(PATTERNS[kind] ?? kind)
}

/** Spreadable props that fire a haptic on press. e.g. <button {...tactile()} /> */
export function tactile(kind = 'light') {
  return { onPointerDown: () => haptic(kind) }
}
