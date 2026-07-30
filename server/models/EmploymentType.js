import mongoose from 'mongoose'

const { Schema, model } = mongoose

/**
 * An employment classification (Intern, Full-time, Part-time, or any custom
 * one an admin adds) carrying its own leave policy: how many days of each
 * currently-known LeaveType a person on this classification is granted.
 *
 * `quotas` is a plain `{ [leaveTypeKey]: days }` map — same shape convention
 * as `User.leaveBalances` — rather than a sub-document array, since it's
 * always read/written as a whole by key, never queried by individual entry.
 *
 * Editing quotas here is deliberately NOT retroactive: `User.leaveQuotas` is
 * a frozen snapshot taken at assignment time (see models/User.js), so
 * changing an EmploymentType's numbers only affects people assigned to it
 * afterward.
 */
const employmentTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    quotas: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
)

employmentTypeSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    name: this.name,
    quotas: this.quotas || {},
  }
}

export const EmploymentType = model('EmploymentType', employmentTypeSchema)
