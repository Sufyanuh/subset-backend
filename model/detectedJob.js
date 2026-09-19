import { Schema, model } from "mongoose";

const detectedJobSchema = new Schema(
  {
    studio: {
      type: Schema.Types.ObjectId,
      ref: "monitoredStudio",
      default: null,
    },
    studioName: {
      type: String,
      trim: true,
      default: "",
    },
    watchUrl: {
      type: String,
      required: true,
      trim: true,
    },
    watchUuid: {
      type: String,
      default: "",
      index: true,
    },
    diff: {
      type: String,
      default: "",
    },
    diffFull: {
      type: String,
      default: "",
    },
    snapshotUrl: {
      type: String,
      default: "",
    },
    matchedCategories: [
      {
        type: Schema.Types.ObjectId,
        ref: "jobCategories",
      },
    ],
    matchedCategoryNames: {
      type: [String],
      default: [],
    },
    suggestedJobTitle: {
      type: String,
      trim: true,
      default: "",
    },
    suggestedLocation: {
      type: String,
      trim: true,
      default: "",
    },
    aboutCompany: {
      type: String,
      default: "",
    },
    website: {
      type: String,
      trim: true,
      default: "",
    },
    instagram: {
      type: String,
      trim: true,
      default: "",
    },
    linkedin: {
      type: String,
      trim: true,
      default: "",
    },
    visualAssets: {
      type: [String],
      default: [],
    },
    workplaceType: {
      type: String,
      enum: ["On-site", "Hybrid", "Remote"],
      default: "On-site",
    },
    contractType: {
      type: String,
      enum: ["Full-time", "Part-time", "Contract", "Freelance", "Internship"],
      default: "Full-time",
    },
    salaryRange: {
      type: String,
      trim: true,
      default: "",
    },
    overview: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    convertedJobId: {
      type: Schema.Types.ObjectId,
      ref: "job",
      default: null,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "admin",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rawPayload: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

detectedJobSchema.index({ createdAt: -1 });

export const DetectedJob = model("detectedJob", detectedJobSchema);
