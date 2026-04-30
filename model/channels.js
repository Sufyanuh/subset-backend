import { Schema, model } from "mongoose";

const channelSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    order: { type: Number, default: 0 },
  },

  {
    timestamps: true,
  }
);

export const Channels = model("channels", channelSchema);
