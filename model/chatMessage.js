import mongoose from "mongoose";

const { Schema } = mongoose;

const MessageSchema = new Schema(
  {
    conversationId: { type: String, index: true, required: true },
    sender: { type: Schema.Types.ObjectId, ref: "user", required: true, index: true },
    recipient: { type: Schema.Types.ObjectId, ref: "user", required: true, index: true },
    text: { type: String, default: "" },
    media: [
      {
        url: { type: String },
        mediaType: { type: String, enum: ["image", "video", "audio", "file"], default: "file" },
      },
    ],
    deliveredAt: { type: Date },
    readAt: { type: Date },
  },
  { timestamps: true }
);

MessageSchema.index({ conversationId: 1, createdAt: -1 });

export const Message = mongoose.model("Message", MessageSchema);




