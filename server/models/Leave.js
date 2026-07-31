import mongoose from 'mongoose'

const { Schema, model } = mongoose

/**
 * A leave OR work-from-home application — same lifecycle either way:
 * pending -> approved | rejected, decided by the owner's direct manager.
 * Balance is deducted only on approval of a `kind: 'leave'` doc (see
 * routes/leaves.js), never at apply time — so a rejected request costs the
 * employee nothing. `kind: 'wfh'` never touches any balance at all: it's a
 * location change, not time off, which is also why it has no `type`.
 */
const leaveSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['leave', 'wfh'], default: 'leave', required: true, index: true },
    // Only meaningful (and required) for kind: 'leave' — a WFH request has no
    // quota-based type. References a LeaveType.key — no compile-time enum
    // since types are now admin-managed DB records; routes/leaves.js
    // validates the submitted key against currently-active LeaveType docs.
    type: {
      type: String,
      required: function isLeaveType() {
        return this.kind === 'leave'
      },
    },

    // Inclusive date range. Stored at UTC midnight (see routes for normalization).
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    // Which part of the working day the request covers. 'first'/'second' are
    // half days — only valid for single-day requests (routes enforce that)
    // and count as 0.5 days against the balance.
    dayPart: { type: String, enum: ['full', 'first', 'second'], default: 'full' },
    // Working-hours window as 'HH:MM' strings (defaulted by the client from
    // the day part, e.g. full 09:00–18:00, first half 09:00–13:30). Display
    // only — `days` stays the unit that balances are counted in.
    startTime: { type: String, trim: true, default: '' },
    endTime: { type: String, trim: true, default: '' },
    // Inclusive calendar-day count (v1 counts weekends too — see requirements §5).
    // Half-day requests are 0.5.
    days: { type: Number, required: true, min: 0.5 },

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
    // Human-readable staff code + email (populated by routes) so request
    // cards can identify the requester beyond just their name.
    employeeId: this.userId?.employeeId ?? null,
    employeeEmail: this.userId?.email ?? null,
    kind: this.kind,
    type: this.type ?? null,
    startDate: this.startDate,
    endDate: this.endDate,
    dayPart: this.dayPart ?? 'full',
    startTime: this.startTime || null,
    endTime: this.endTime || null,
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
