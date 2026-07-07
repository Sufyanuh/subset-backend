import { Schema, model } from "mongoose";

const spotlightSchema = new Schema(
  {
    discovery_ids: {
      type: [Schema.Types.ObjectId],
      ref: "discover",
      required: true,
    },
    title: {
      type: [String],
      required: true,
    },
    description: {
      type: String,
      required: false,
    },
    redirection_url: {
      type: String,
      required: false,
    },
  },
  { timestamps: true },
);

export const Spotlight = model("spotlight", spotlightSchema);
