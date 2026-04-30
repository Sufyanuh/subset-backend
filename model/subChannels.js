  import { Schema, model } from "mongoose";

const subChannelsSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    channel: {
      type: Schema.Types.ObjectId,
      ref: "channels",
      required: true,
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
    forAdmin: {
      type: Boolean,
      default: false,
    },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const SubChannels = model("SubChannel", subChannelsSchema);
