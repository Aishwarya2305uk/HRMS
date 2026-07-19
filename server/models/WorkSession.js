import mongoose from 'mongoose'
import { FULL_WORKDAY_SECONDS } from '../config.js'

const { Schema, model } = mongoose

/**
 * One work session per employee per calendar day (Zoho-style check-in timer).
 *
 * The source of truth is the ordered `events` log — NOT a running counter.
 * Worked time is always *computed* from these events on the server, so the
 * timer is refresh-proof and re-login-proof: the client only displays elapsed
 * time derived from the stored events.
 *
 *   check_in  -> starts a running interval
 *   pause     -> ends the current running interval (break — not counted)
 *   resume    -> starts a new running interval
 *   check_out -> ends the current interval and finalizes the day (manual)
 *   auto_close-> ends the day automatically at EOD if the user forgot to check out
 */
const eventSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['check_in', 'pause', 'resume', 'check_out', 'auto_close'],
      required: true,
    },
    at: { type: Date, required: true },
  },
  { _id: false },
)

const workSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Calendar day this session belongs to, as 'YYYY-MM-DD' (local day key).
    date: { type: String, required: true, index: true },

    events: { type: [eventSchema], default: [] },

    // Lifecycle: 'active' while the day is open (running or paused),
    // 'completed' after manual check-out, 'auto_closed' after EOD auto-finalize.
    status: {
      type: String,
      enum: ['active', 'completed', 'auto_closed'],
      default: 'active',
    },

    // Finalized totals — written once the day is closed (checkout/auto-close).
    workedSeconds: { type: Number, default: 0 },
    // Attendance verdict for the day: 'present' (>= 8h) or 'leave' (< 8h).
    dayStatus: { type: String, enum: ['present', 'leave', null], default: null },
  },
  { timestamps: true },
)

// One session per user per day.
workSessionSchema.index({ userId: 1, date: 1 }, { unique: true })

/**
 * Compute worked seconds from the event log up to `upto` (default: now).
 * Running intervals are opened by check_in/resume and closed by
 * pause/check_out/auto_close. A still-open interval is measured up to `upto`.
 */
export function computeWorkedSeconds(events, upto = Date.now()) {
  let total = 0
  let openAt = null
  for (const ev of events) {
    const t = new Date(ev.at).getTime()
    if (ev.type === 'check_in' || ev.type === 'resume') {
      if (openAt === null) openAt = t
    } else if (ev.type === 'pause' || ev.type === 'check_out' || ev.type === 'auto_close') {
      if (openAt !== null) {
        total += Math.max(0, t - openAt)
        openAt = null
      }
    }
  }
  if (openAt !== null) total += Math.max(0, upto - openAt)
  return Math.floor(total / 1000)
}

/** Is the timer currently running (checked in and not paused)? */
export function isRunning(events) {
  let running = false
  for (const ev of events) {
    if (ev.type === 'check_in' || ev.type === 'resume') running = true
    else if (ev.type === 'pause' || ev.type === 'check_out' || ev.type === 'auto_close')
      running = false
  }
  return running
}

/** Live, computed view of a session for the API (status + elapsed seconds). */
workSessionSchema.methods.toLiveJSON = function toLiveJSON(now = Date.now()) {
  const open = this.status === 'active'
  const running = open && isRunning(this.events)
  const workedSeconds = open ? computeWorkedSeconds(this.events, now) : this.workedSeconds
  const firstIn = this.events.find((e) => e.type === 'check_in')
  const lastOut = [...this.events]
    .reverse()
    .find((e) => e.type === 'check_out' || e.type === 'auto_close')
  return {
    date: this.date,
    // timerState drives the UI button: 'out' (not started), 'running', 'paused', 'done'.
    timerState: !open ? 'done' : running ? 'running' : this.events.length ? 'paused' : 'out',
    running,
    workedSeconds,
    fullDaySeconds: FULL_WORKDAY_SECONDS,
    status: this.status,
    dayStatus: this.dayStatus,
    checkInAt: firstIn ? firstIn.at : null,
    checkOutAt: lastOut ? lastOut.at : null,
  }
}

export const WorkSession = model('WorkSession', workSessionSchema)
