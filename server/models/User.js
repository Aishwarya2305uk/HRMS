import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { LeaveType } from './LeaveType.js'
import { EmploymentType } from './EmploymentType.js'

const { Schema, model } = mongoose

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // Human-readable staff code ("EMP001") shown on profiles and request
    // cards. Auto-assigned by the pre-save hook below (and backfilled for
    // pre-existing users by bootstrapEmployeeIds.js) — never user-supplied.
    // `sparse` so docs from before the backfill don't collide on null.
    employeeId: { type: String, trim: true, unique: true, sparse: true, index: true },
    // Never stored in plaintext — hashed via the pre-save hook below.
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['employee', 'manager', 'admin'],
      default: 'employee',
      required: true,
    },
    designation: { type: String, trim: true, default: '' },
    department: { type: String, trim: true, default: '' },
    joiningDate: { type: Date },
    // The reporting relationship that builds the org tree.
    managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Employment classification (Intern/Full-time/Part-time/custom) — decides
    // which leave policy this person is granted. See EmploymentType.js.
    employmentType: { type: Schema.Types.ObjectId, ref: 'EmploymentType', default: null },

    // ---- Personal profile (server/routes/employees.js :id/profile) ----
    // A compressed JPEG data URL, capped client- and server-side around ~1MB
    // decoded. Shown broadly (avatars); the rest below are PII and only ever
    // returned via toProfileJSON() to an authorized viewer (self or admin).
    photoUrl: { type: String, default: '', maxlength: 1_400_000 },
    dob: { type: Date },
    address: { type: String, trim: true, default: '', maxlength: 300 },
    phone: { type: String, trim: true, default: '', maxlength: 20 },
    education: { type: String, trim: true, default: '', maxlength: 500 },
    aadharNumber: {
      type: String,
      trim: true,
      default: '',
      maxlength: 12,
      validate: {
        validator: (v) => !v || /^\d{12}$/.test(v),
        message: 'Aadhar number must be exactly 12 digits.',
      },
    },
    // Remaining days per leave type, e.g. { casual: 12, sick: 8, earned: 15 }.
    // Seeded from the assigned employmentType's quotas at creation/reassignment
    // time (see routes/employees.js); deducted only when a leave is approved.
    leaveBalances: {
      type: Schema.Types.Mixed,
      default: {},
    },
    // Frozen snapshot of what this person was GRANTED — set once whenever
    // employmentType is assigned/changed, deliberately never touched by
    // approvals (which only mutate leaveBalances above). This is what makes
    // "editing a policy's quotas later doesn't retroactively change people
    // already hired under it" possible: querying the EmploymentType live
    // would give the CURRENT quota, not the one this person actually got.
    leaveQuotas: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
)

/**
 * Fills gaps in leaveBalances for any currently-active LeaveType this user
 * doesn't yet have an entry for (e.g. an admin added a new leave type after
 * this person was hired) — pulling the gap-fill amount from their CURRENT
 * employmentType's quota, or 0 if unassigned/not found there. Async because
 * it needs to read both collections; its two call sites (leaves.js's apply
 * and approve handlers) are already inside async route handlers.
 */
userSchema.methods.ensureLeaveBalances = async function ensureLeaveBalances() {
  const [activeTypes, employmentType] = await Promise.all([
    LeaveType.find({ active: true }).select('key'),
    this.employmentType ? EmploymentType.findById(this.employmentType).select('quotas') : null,
  ])
  const quotas = employmentType?.quotas || {}
  const merged = { ...(this.leaveBalances || {}) }
  for (const t of activeTypes) {
    if (merged[t.key] === undefined) merged[t.key] = Number(quotas[t.key]) || 0
  }
  this.leaveBalances = merged
  this.markModified('leaveBalances')
  return merged
}

/**
 * Next unused "EMP###" code. Scans existing codes for the highest numeric
 * suffix rather than keeping a counter document — user creation is rare and
 * admin-only, so a scan is simpler than another collection to bootstrap.
 * Pads to 3 digits but keeps growing past EMP999 (EMP1000, ...).
 */
userSchema.statics.nextEmployeeId = async function nextEmployeeId() {
  const codes = await this.find({ employeeId: /^EMP\d+$/ }).select('employeeId')
  const max = codes.reduce((m, u) => Math.max(m, Number(u.employeeId.slice(3))), 0)
  return `EMP${String(max + 1).padStart(3, '0')}`
}

// Assign a code to any user saved without one (new hires, the bootstrap admin).
userSchema.pre('save', async function assignEmployeeId() {
  if (!this.employeeId) this.employeeId = await this.constructor.nextEmployeeId()
})

/**
 * Convenience virtual/statics for setting a plaintext password. We hash on
 * save whenever a `password` field is assigned to the doc.
 */
userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 10)
}

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.passwordHash)
}

/** Shape sent to the client — never includes the hash. */
userSchema.methods.toSafeJSON = function toSafeJSON() {
  const balances = this.leaveBalances || {}
  const quotas = this.leaveQuotas || {}
  const sum = (obj) => Object.values(obj).reduce((s, v) => s + (Number(v) || 0), 0)
  return {
    id: this._id.toString(),
    employeeId: this.employeeId || null,
    name: this.name,
    email: this.email,
    role: this.role,
    designation: this.designation,
    department: this.department,
    joiningDate: this.joiningDate,
    // Low-sensitivity, shown wherever an avatar is — unlike the rest of the
    // profile (dob/address/phone/education/aadhar), which stays out of every
    // broad endpoint (login, org tree, employee list) and is only ever
    // returned by toProfileJSON() to a viewer the route has already authorized.
    photoUrl: this.photoUrl || '',
    // `managerId`/`employmentType` may be populated sub-documents (callers
    // that used .populate(...)) or plain ObjectIds — always return the raw
    // hex id either way, never a Mongoose debug string. Resolved display
    // names (managerName, employmentTypeName) are attached by routes that
    // populate, same pattern for both.
    managerId: this.managerId ? (this.managerId._id ?? this.managerId).toString() : null,
    employmentType: this.employmentType ? (this.employmentType._id ?? this.employmentType).toString() : null,
    // Per-type remaining days plus a rolled-up total (for the balance ring).
    // Both computed straight from stored fields — no policy lookup here, so
    // this stays synchronous. leaveQuotaTotal is what THIS person was
    // actually granted (leaveQuotas), not the employment type's current
    // policy, which may have changed since.
    leaveBalances: balances,
    leaveBalance: sum(balances),
    leaveQuotaTotal: sum(quotas),
  }
}

/**
 * Full personal profile for the dedicated profile page — everything
 * toSafeJSON() has, plus PII it deliberately omits (DOB, address, phone,
 * education, Aadhar). Callers MUST authorize the viewer (self or admin)
 * before calling this; the method itself assumes that already happened.
 */
userSchema.methods.toProfileJSON = function toProfileJSON() {
  return {
    ...this.toSafeJSON(),
    dob: this.dob ?? null,
    address: this.address || '',
    phone: this.phone || '',
    education: this.education || '',
    aadharNumber: this.aadharNumber || '',
  }
}

export const User = model('User', userSchema)
