/**
 * Manually triggers the initial admin bootstrap without starting the whole
 * server. connectDB() already runs bootstrapAdmin() on every fresh connect
 * (see db.js), so this script is really just "connect once, then exit" —
 * handy the first time you point at a brand new database, e.g. right after
 * setting DATABASE_URL for the first time.
 *
 * Run with:  npm run seed   (uses DATABASE_URL, then disconnects)
 */
import { pathToFileURL } from 'node:url'
import { connectDB, closeDB } from './db.js'

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  connectDB()
    .then(() => closeDB())
    .then(() => {
      console.log('[seed] done.')
      process.exit(0)
    })
    .catch((err) => {
      console.error('[seed] failed:', err.message)
      process.exit(1)
    })
}
