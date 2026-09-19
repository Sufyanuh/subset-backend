import { Schema, model } from "mongoose";

const monitoredStudioSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    website: {
      type: String,
      trim: true,
      default: "",
    },
    targetUrl: {
      type: String,
      required: true,
      trim: true,
    },
    careerUrl: {
      type: String,
      trim: true,
      default: "",
    },
    location: {
      type: String,
      trim: true,
      default: "",
    },
    disciplines: {
      type: [String],
      default: [],
    },
    changedetectionUuid: {
      type: String,
      default: null,
      index: true,
    },
    changedetectionStatus: {
      type: String,
      enum: ["unregistered", "registered", "error", "paused"],
      default: "unregistered",
    },
    lastError: {
      type: String,
      default: "",
    },
    lastCheckedAt: {
      type: Date,
      default: null,
    },
    lastChangeDetectedAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    tags: {
      type: [String],
      default: ["studio"],
    },
  },
  {
    timestamps: true,
  }
);

monitoredStudioSchema.index({ targetUrl: 1 }, { unique: true });
monitoredStudioSchema.index({ name: 1 });

export const MonitoredStudio = model("monitoredStudio", monitoredStudioSchema);
