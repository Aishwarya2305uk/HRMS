/**
 * Seeds the initial users so login works out of the box. Idempotent:
 * re-running updates the demo users' passwords/roles rather than duplicating.
 *
 * Run with:  npm run seed   (connects using MONGODB_URL, then disconnects)
 * Or import { seedDemoUsers } to seed against an already-open connection.
 */
import mongoose from 'mongoose'
import { pathToFileURL } from 'node:url'
import { connectDB } from './db.js'
import { User } from './models/User.js'
import { defaultLeaveBalances } from './config.js'

const DEMO_USERS = [
  {
    name: 'Priya Admin',
    email: 'admin@trula.com',
    password: 'admin123',
    role: 'admin',
    designation: 'HR Administrator',
    department: 'People Ops',
    joiningDate: '2022-01-10',
  },
  {
    name: 'Rahul Manager',
    email: 'manager@trula.com',
    password: 'manager123',
    role: 'manager',
    designation: 'Engineering Manager',
    department: 'Engineering',
    joiningDate: '2022-03-01',
  },
  {
    name: 'Aisha Employee',
    email: 'employee@trula.com',
    password: 'employee123',
    role: 'employee',
    designation: 'Software Engineer',
    department: 'Engineering',
    joiningDate: '2023-06-15',
  },
  {
    name: 'Vikram Rao',
    email: 'vikram@trula.com',
    password: 'employee123',
    role: 'employee',
    designation: 'QA Engineer',
    department: 'Engineering',
    joiningDate: '2023-09-01',
  },
]

/** Upserts the demo users and wires up the reporting tree. Assumes a live connection. */
export async function seedDemoUsers() {
  const byEmail = {}
  for (const u of DEMO_USERS) {
    let doc = await User.findOne({ email: u.email })
    if (!doc) doc = new User({ email: u.email })
    doc.name = u.name
    doc.role = u.role
    doc.designation = u.designation
    doc.department = u.department
    doc.joiningDate = new Date(u.joiningDate)
    if (!doc.leaveBalances) doc.leaveBalances = defaultLeaveBalances()
    await doc.setPassword(u.password)
    await doc.save()
    byEmail[u.email] = doc
    console.log(`[seed] upserted ${u.role.padEnd(8)} ${u.email}`)
  }

  byEmail['manager@trula.com'].managerId = byEmail['admin@trula.com']._id
  byEmail['employee@trula.com'].managerId = byEmail['manager@trula.com']._id
  byEmail['vikram@trula.com'].managerId = byEmail['manager@trula.com']._id
  await byEmail['manager@trula.com'].save()
  await byEmail['employee@trula.com'].save()
  await byEmail['vikram@trula.com'].save()
  console.log('[seed] linked reporting tree: 2 employees → manager → admin')
  return byEmail
}

// Run standalone: connect, seed, disconnect.
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  connectDB()
    .then(seedDemoUsers)
    .then(() => mongoose.disconnect())
    .then(() => {
      console.log('[seed] done.')
      process.exit(0)
    })
    .catch((err) => {
      console.error('[seed] failed:', err.message)
      process.exit(1)
    })
}
