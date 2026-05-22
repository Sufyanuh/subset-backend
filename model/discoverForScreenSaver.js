import { Schema, model } from "mongoose";

const discoverforScreenSaverSchema = new Schema(
  {
    discoverId: { type: Schema.Types.ObjectId, ref: "discover" },
  },
  { timestamps: true },
);

export const DiscoverforScreenSaver = model(
  "discoverforScreenSaver",
  discoverforScreenSaverSchema,
);
