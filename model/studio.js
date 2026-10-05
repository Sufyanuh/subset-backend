import { Schema, model } from "mongoose";

const selectorSchema = new Schema(
  {
    jobContainer: {
      type: String,
      default: "",
      trim: true,
    },
    titleSelector: {
      type: String,
      default: "",
      trim: true,
    },
    locationSelector: {
      type: String,
      default: "",
      trim: true,
    },
    applyUrlSelector: {
      type: String,
      default: "",
      trim: true,
    },
    salarySelector: {
      type: String,
      default: "",
      trim: true,
    },
    departmentSelector: {
      type: String,
      default: "",
      trim: true,
    },
    workplaceTypeSelector: {
      type: String,
      default: "",
      trim: true,
    },
    contractTypeSelector: {
      type: String,
      default: "",
      trim: true,
    },
    descriptionSelector: {
      type: String,
      default: "",
      trim: true,
    },
    imageSelector: {
      type: String,
      default: "",
      trim: true,
    },
    companyNameSelector: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
);

const scrapingConfigSchema = new Schema(
  {
    selectors: {
      type: selectorSchema,
      default: () => ({}),
    },
    requiresPuppeteer: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: [
        "active",
        "pending_discovery",
        "discovered",
        "failed",
        "unsupported",
        "paused",
      ],
      default: "active",
      index: true,
    },
    lastDiscoveredAt: {
      type: Date,
      default: null,
    },
    discoveryAttempts: {
      type: Number,
      default: 0,
    },
    lastScrapedAt: {
      type: Date,
      default: null,
    },
    lastScrapedJobCount: {
      type: Number,
      default: 0,
    },
    lastError: {
      type: String,
      default: "",
    },
  },
  { _id: false }
);

const studioSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    website: {
      type: String,
      trim: true,
      default: "",
    },
    careersUrl: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    location: {
      type: String,
      trim: true,
      default: "",
    },
    aboutCompany: {
      type: String,
      default: "",
    },
    logo: {
      type: String,
      default: "",
    },
    favicon: {
      type: String,
      default: "",
    },
    visualAssets: {
      type: [String],
      default: [],
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
    companySize: {
      type: String,
      trim: true,
      default: "",
    },
    disciplines: {
      type: [String],
      default: [],
    },
    atsType: {
      type: String,
      enum: ["greenhouse", "lever", "ashby", "custom", "unknown"],
      default: "unknown",
      index: true,
    },
    atsIdentifier: {
      type: String,
      trim: true,
      default: "",
    },
    scrapingConfig: {
      type: scrapingConfigSchema,
      default: () => ({}),
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
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

studioSchema.index({ atsType: 1, isActive: 1 });

export const Studio = model("studio", studioSchema);
