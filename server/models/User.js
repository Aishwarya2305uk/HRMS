import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { LEAVE_TYPES, defaultLeaveBalances, TOTAL_ANNUAL_QUOTA } from '../config.js'

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
    // Seeded from config quotas; deducted only when a manager approves a leave.
    leaveBalances: {
      type: Schema.Types.Mixed,
      default: defaultLeaveBalances,
    },
  },
  { timestamps: true },
)

/** Ensure a full set of balances exists (fills gaps for any newly-added type). */
userSchema.methods.ensureLeaveBalances = function ensureLeaveBalances() {
  const defaults = defaultLeaveBalances()
  const current = this.leaveBalances || {}
  const merged = { ...defaults, ...current }
  this.leaveBalances = merged
  this.markModified('leaveBalances')
  return merged
}

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
  const balances = { ...defaultLeaveBalances(), ...(this.leaveBalances || {}) }
  const total = LEAVE_TYPES.reduce((sum, t) => sum + (Number(balances[t.key]) || 0), 0)
  return {
    id: this._id.toString(),
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
    // `managerId` may be a populated User sub-document (callers that used
    // .populate('managerId', ...)) or a plain ObjectId — always return the
    // raw hex id either way, never a Mongoose debug string.
    managerId: this.managerId ? (this.managerId._id ?? this.managerId).toString() : null,
    // Per-type remaining days plus a rolled-up total (for the balance ring).
    leaveBalances: balances,
    leaveBalance: total,
    leaveQuotaTotal: TOTAL_ANNUAL_QUOTA,
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
