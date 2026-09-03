import { Schema, model } from "mongoose";

const jobCategorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    position: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

export const JobCategory = model("jobCategories", jobCategorySchema);
