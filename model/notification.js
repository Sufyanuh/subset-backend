import mongoose from "mongoose";

const { Schema } = mongoose;

const NotificationSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["message", "post", "comment"],
      required: true,
    },
    actor: { type: Schema.Types.ObjectId, ref: "user", required: true },
    recipient: {
      type: Schema.Types.ObjectId,
      ref: "user",
      required: true,
      index: true,
    },
    post: { type: Schema.Types.ObjectId, ref: "Post" },
    comment: { type: Schema.Types.ObjectId, ref: "Comment" },
    message: { type: Schema.Types.ObjectId, ref: "Message" },
    conversationId: { type: String },
    title: { type: String, default: "" },
    body: { type: String, default: "" },
    isRead: { type: Boolean, default: false, index: true },
    emailSent: { type: Boolean, default: false, index: true },
    emailSentAt: { type: Date },
    emailFrequency: {
      type: String,
      enum: ["immediate", "daily", "weekly", "never"],
      default: "daily",
    },
  },
  { timestamps: true }
);

NotificationSchema.index({ recipient: 1, emailSent: 1, createdAt: -1 });
NotificationSchema.index({ emailSent: 1, createdAt: -1 });
NotificationSchema.index({ recipient: 1, createdAt: -1 });

export const Notification = mongoose.model("Notification", NotificationSchema);
