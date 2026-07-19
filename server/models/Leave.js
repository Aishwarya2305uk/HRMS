import mongoose from 'mongoose'
import { LEAVE_TYPE_KEYS } from '../config.js'

const { Schema, model } = mongoose

/**
 * A leave application. Flows: pending -> approved | rejected.
 * Balance is deducted only on approval (see routes/leaves.js), never at apply
 * time — so a rejected request costs the employee nothing.
 */
const leaveSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: LEAVE_TYPE_KEYS, required: true },

    // Inclusive date range. Stored at UTC midnight (see routes for normalization).
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    // Inclusive calendar-day count (v1 counts weekends too — see requirements §5).
    days: { type: Number, required: true, min: 1 },

    reason: { type: String, trim: true, default: '' },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },

    // Who decided, when, and why (rejection comment is optional).
    approverId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionComment: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
)

/** Client-facing shape. Populated fields (user/approver) are attached by routes. */
leaveSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    userId: this.userId?._id ? this.userId._id.toString() : this.userId?.toString(),
    employeeName: this.userId?.name ?? null,
    type: this.type,
    startDate: this.startDate,
    endDate: this.endDate,
    days: this.days,
    reason: this.reason,
    status: this.status,
    approverId: this.approverId ? this.approverId.toString() : null,
    decidedAt: this.decidedAt,
    decisionComment: this.decisionComment,
    createdAt: this.createdAt,
  }
}

export const Leave = model('Leave', leaveSchema)
