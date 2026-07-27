import mongoose from 'mongoose'

const { Schema, model } = mongoose

/**
 * A named sub-group of a manager's own reports (e.g. "Project Alpha"), used
 * only to target announcements more precisely than the whole reporting
 * subtree. Membership is validated server-side (see server/routes/teams.js)
 * against the creating manager's own subtree at every create/edit — a team
 * can never reach anyone its manager couldn't already reach via the
 * existing whole-subtree 'team' broadcast, so this adds no new authority.
 */
const teamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    memberIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: true },
)

/** Client-facing shape. `members` (id+name) is attached by routes that populate. */
teamSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    name: this.name,
    managerId: this.managerId?._id ? this.managerId._id.toString() : this.managerId?.toString(),
    memberIds: this.memberIds.map((m) => (m?._id ? m._id.toString() : m?.toString())),
    memberCount: this.memberIds.length,
    createdAt: this.createdAt,
  }
}

export const Team = model('Team', teamSchema)
