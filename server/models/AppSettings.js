import mongoose from 'mongoose'

const { Schema, model } = mongoose

/**
 * Single-document collection for org-wide settings an admin edits from the
 * "Other Settings" page. Today that's the two external form links surfaced
 * at the bottom of everyone's sidebar (Feedback / HR Request). Always go
 * through getSingleton() so there is exactly one document.
 */
const appSettingsSchema = new Schema(
  {
    feedbackFormUrl: { type: String, default: '', trim: true, maxlength: 2048 },
    hrRequestFormUrl: { type: String, default: '', trim: true, maxlength: 2048 },
  },
  { timestamps: true },
)

/** Upsert-on-read: the first access creates the (empty) document atomically. */
appSettingsSchema.statics.getSingleton = function getSingleton() {
  return this.findOneAndUpdate({}, {}, { new: true, upsert: true, setDefaultsOnInsert: true })
}

appSettingsSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    feedbackFormUrl: this.feedbackFormUrl,
    hrRequestFormUrl: this.hrRequestFormUrl,
  }
}

export const AppSettings = model('AppSettings', appSettingsSchema)
