import mongoose from 'mongoose'

const { Schema, model } = mongoose

/**
 * A broadcast message — covers both regular announcements and urgent ones
 * (see `type`); "pending work" (leave approvals/requests) is never stored
 * here, it's derived live from the Leave collection.
 *
 * Audience is one of three mutually exclusive scopes:
 *  - 'all'  — everyone (admin only)
 *  - 'role' — everyone with `audienceRole` (admin only)
 *  - 'team' — `audienceRootId` plus everyone who transitively reports to them
 *             (admin: any user; manager: only themselves)
 * See server/services/hierarchy.js for how 'team' membership is resolved.
 */
const announcementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    type: {
      type: String,
      enum: ['announcement', 'urgent'],
      default: 'announcement',
      index: true,
    },

    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    audienceScope: { type: String, enum: ['all', 'role', 'team'], required: true },
    // Set only when audienceScope === 'role'.
    audienceRole: { type: String, enum: ['employee', 'manager', 'admin'], default: null },
    // Set only when audienceScope === 'team'.
    audienceRootId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // Who has seen this — checked with $addToSet, never re-read wholesale by
    // the client (see toJSONSafe: a per-viewer `read` flag is computed by the
    // route instead of exposing this array).
    readBy: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: true },
)

announcementSchema.index({ createdAt: -1 })

/** Client-facing shape. Populated fields (author/audienceRoot) are attached by routes. */
announcementSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    title: this.title,
    body: this.body,
    type: this.type,
    authorId: this.authorId?._id ? this.authorId._id.toString() : this.authorId?.toString(),
    authorName: this.authorId?.name ?? null,
    audienceScope: this.audienceScope,
    audienceRole: this.audienceRole,
    audienceRootId: this.audienceRootId?._id
      ? this.audienceRootId._id.toString()
      : this.audienceRootId?.toString() ?? null,
    audienceRootName: this.audienceRootId?.name ?? null,
    createdAt: this.createdAt,
  }
}

export const Announcement = model('Announcement', announcementSchema)
