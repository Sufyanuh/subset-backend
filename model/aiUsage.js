import { Schema, model } from "mongoose";

const aiUsageSchema = new Schema(
  {
    provider: {
      type: String,
      enum: ["gemini", "openai", "other"],
      required: true,
      index: true,
    },
    model: {
      type: String,
      required: true,
      trim: true,
    },
    feature: {
      type: String,
      required: true,
      enum: [
        "scraper_discovery",
        "scraper_spa_eval",
        "image_rekognition",
        "custom",
      ],
      default: "scraper_discovery",
      index: true,
    },
    studioId: {
      type: Schema.Types.ObjectId,
      ref: "Studio",
      default: null,
    },
    studioName: {
      type: String,
      trim: true,
      default: "",
    },
    promptTokens: {
      type: Number,
      default: 0,
    },
    completionTokens: {
      type: Number,
      default: 0,
    },
    totalTokens: {
      type: Number,
      required: true,
      default: 0,
      index: true,
    },
    estimatedCostUsd: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["success", "error"],
      default: "success",
      index: true,
    },
    errorMessage: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for fast aggregation by date and provider
aiUsageSchema.index({ createdAt: -1 });
aiUsageSchema.index({ provider: 1, createdAt: -1 });

export const AiUsage = model("ai_usage", aiUsageSchema);
export default AiUsage;
