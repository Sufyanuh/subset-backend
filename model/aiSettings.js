import { Schema, model } from "mongoose";

const aiSettingsSchema = new Schema(
  {
    monthlyTokenQuota: {
      type: Number,
      default: 1000000, // 1 Million tokens default quota
    },
    monthlyBudgetUsd: {
      type: Number,
      default: 10.0, // $10 budget default
    },
    alertThresholdPercent: {
      type: Number,
      default: 80, // Alert at 80% usage
    },
  },
  {
    timestamps: true,
  }
);

export const AiSettings = model("ai_settings", aiSettingsSchema);
export default AiSettings;
