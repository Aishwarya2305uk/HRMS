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
    managerId: this.managerId ? this.managerId.toString() : null,
    // Per-type remaining days plus a rolled-up total (for the balance ring).
    leaveBalances: balances,
    leaveBalance: total,
    leaveQuotaTotal: TOTAL_ANNUAL_QUOTA,
  }
}

export const User = model('User', userSchema)
