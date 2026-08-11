/**
 * The selectable workspace themes (16). Every role gets the same list —
 * picking one sets `data-theme` on the portal root (see Portal.jsx), whose
 * CSS block overrides the accent variables and sidebar tint (see
 * EmployeeDashboard.css).
 *
 * The first entry ('' key) is "no override": the classic Trust Blue accent,
 * which still deepens per role via the data-role rules.
 *
 * `swatch` is only the dot shown in the picker UI — the actual colors live in
 * CSS so themes stay a pure styling concern.
 */
export const THEMES = [
  { key: '', label: 'Trust Blue', swatch: '#2563eb' },
  { key: 'indigo', label: 'Indigo', swatch: '#4f46e5' },
  { key: 'violet', label: 'Violet', swatch: '#7c3aed' },
  { key: 'purple', label: 'Purple', swatch: '#9333ea' },
  { key: 'fuchsia', label: 'Fuchsia', swatch: '#c026d3' },
  { key: 'emerald', label: 'Emerald', swatch: '#059669' },
  { key: 'forest', label: 'Forest', swatch: '#15803d' },
  { key: 'teal', label: 'Teal', swatch: '#0d9488' },
  { key: 'ocean', label: 'Ocean', swatch: '#0891b2' },
  { key: 'sky', label: 'Sky', swatch: '#0284c7' },
  { key: 'amber', label: 'Amber', swatch: '#d97706' },
  { key: 'orange', label: 'Orange', swatch: '#ea580c' },
  { key: 'rose', label: 'Rose', swatch: '#e11d48' },
  { key: 'crimson', label: 'Crimson', swatch: '#dc2626' },
  { key: 'slate', label: 'Slate', swatch: '#475569' },
  { key: 'stone', label: 'Stone', swatch: '#57534e' },
]

// Keyed per user id so two people sharing a browser keep separate choices —
// same approach as the other UI prefs (e.g. hrms.sidebarCollapsed).
const storageKey = (userId) => `hrms.theme.${userId ?? 'anon'}`

/** Saved theme for this user, falling back to '' if unset or unknown. */
export function getSavedTheme(userId) {
  const saved = localStorage.getItem(storageKey(userId)) || ''
  return THEMES.some((t) => t.key === saved) ? saved : ''
}

export function saveTheme(userId, key) {
  localStorage.setItem(storageKey(userId), key)
}
