/**
 * Person avatar: a photo when one's on file, otherwise the same initial-letter
 * tile every avatar in the app has always used. Drop-in replacement for the
 * `<span className="avatar ...">` markup that was duplicated across Sidebar,
 * TopBar, PeopleAdmin, etc. — sizing/tinting is all still plain CSS classes
 * (see .avatar / .avatar.sm / .avatar.xl / .tint-*).
 *
 * @param {string} name        used for the fallback initial and the img's a11y name
 * @param {string} [photoUrl]  data URL or image URL; falls back when empty
 * @param {'sm'|'xl'} [size]   omit for the default (38px) size
 * @param {string} [tint]      one of the existing avatar tint classes (indigo/blue/green)
 */
export default function Avatar({ name, photoUrl, size, tint, className = '' }) {
  const classes = ['avatar', size, tint && `tint-${tint}`, className].filter(Boolean).join(' ')

  if (photoUrl) {
    return <img className={classes} src={photoUrl} alt="" />
  }
  return (
    <span className={classes} aria-hidden="true">
      {name?.trim()?.[0]?.toUpperCase() ?? '?'}
    </span>
  )
}
