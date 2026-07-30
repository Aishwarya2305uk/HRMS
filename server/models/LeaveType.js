import mongoose from 'mongoose'

const { Schema, model } = mongoose

/**
 * A kind of leave (Casual, Sick, Earned, or anything an admin adds later —
 * e.g. Bereavement Leave). `key` is the stable identifier every `Leave.type`
 * and `EmploymentType.quotas` entry references; `label` is the only part an
 * admin can rename after creation. Retiring a type sets `active: false`
 * rather than deleting it, so historical `Leave` documents referencing the
 * key keep resolving to a real label instead of orphaning.
 */
const leaveTypeSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, unique: true },
    label: { type: String, required: true, trim: true, maxlength: 60 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

leaveTypeSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    key: this.key,
    label: this.label,
    active: this.active,
  }
}

export const LeaveType = model('LeaveType', leaveTypeSchema)
