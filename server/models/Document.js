import mongoose from 'mongoose'

const { Schema, model } = mongoose

// ~3MB decoded (base64 inflates ~4/3). Stored inline as a data URL, same
// approach as User.photoUrl — no separate file store to operate, and it
// stays inside Mongo's 16MB document limit with plenty of headroom.
export const MAX_DOC_DATA_URL_LENGTH = 4_200_000

/** Allowed upload formats — documents an HR file actually needs (ID proofs,
 *  certificates, contracts), not arbitrary executables. */
export const DOC_DATA_URL_RE =
  /^data:(application\/pdf|image\/(png|jpe?g|webp)|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet));base64,/i

/**
 * A document on an employee's HR file (ID proof, certificate, contract…).
 * Access is strictly: the employee themselves, their DIRECT manager, and
 * admins (enforced in routes/documents.js). Deleting is admin-only.
 */
const documentSchema = new Schema(
  {
    // Whose file this document belongs to (not necessarily who uploaded it —
    // an admin can add documents to any employee's file).
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    mimeType: { type: String, required: true, trim: true },
    // Decoded size in bytes, computed server-side from the data URL — for
    // display only, never trusted for the actual storage cap.
    size: { type: Number, required: true, min: 0 },
    dataUrl: { type: String, required: true, maxlength: MAX_DOC_DATA_URL_LENGTH },
    uploadedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

/** Listing shape — deliberately WITHOUT dataUrl, which is fetched one
 *  document at a time via GET /:id/file when actually viewed. */
documentSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    userId: this.userId?._id ? this.userId._id.toString() : this.userId?.toString(),
    name: this.name,
    mimeType: this.mimeType,
    size: this.size,
    uploadedByName: this.uploadedById?.name ?? null,
    createdAt: this.createdAt,
  }
}

export const Document = model('Document', documentSchema)
