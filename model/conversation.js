import mongoose from "mongoose";

const { Schema } = mongoose;

const ConversationSchema = new Schema(
  {
    conversationId: { type: String, required: true, unique: true, index: true },
    userA: { type: Schema.Types.ObjectId, ref: "user", required: true, index: true },
    userB: { type: Schema.Types.ObjectId, ref: "user", required: true, index: true },
    unreadForA: { type: Number, default: 0 },
    unreadForB: { type: Number, default: 0 },
    lastMessageId: { type: Schema.Types.ObjectId, ref: "Message" },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ConversationSchema.index({ userA: 1, lastMessageAt: -1 });
ConversationSchema.index({ userB: 1, lastMessageAt: -1 });

export const Conversation = mongoose.model("Conversation", ConversationSchema);

export const resolveParticipants = (userIdA, userIdB) => {
  const a = String(userIdA);
  const b = String(userIdB);
  return a < b ? { a, b } : { a: b, b: a };
};


