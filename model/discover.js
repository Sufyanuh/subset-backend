import { Schema, model } from "mongoose";
const discoverSchema = Schema(
  {
    title: {
      type: [String],
      required: true,
    },
    uploadAt: {
      type: Date,
      required: true,
      default: Date.now(),
    },
    image: {
      type: String,
      required: true,
    },
    index: {
      type: Number,
      default: 0,
    },
    thumbnail: {
      type: String,
      required: false,
    },
    type: {
      type: String,
      required: true,
      default: "image",
      enum: ["image", "video", "iframe", "mp3"],
    },
    source: {
      type: String,
      required: true,
      default: "xyz.com",
    },
    sourceType: {
      type: String,
      required: true,
      default: "xyz.com",
    },
    tags: {
      type: [String],
      required: true,
    },
    categories: {
      required: true,
      ref: "categories",
      type: [Schema.Types.ObjectId],
    },
  },
  { timestamps: true },
);

export const Discover = model("discover", discoverSchema);
