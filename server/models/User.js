import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

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
    leaveBalance: { type: Number, default: 12 },
  },
  { timestamps: true },
)

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
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    designation: this.designation,
    department: this.department,
    joiningDate: this.joiningDate,
    managerId: this.managerId ? this.managerId.toString() : null,
    leaveBalance: this.leaveBalance,
  }
}

export const User = model('User', userSchema)
