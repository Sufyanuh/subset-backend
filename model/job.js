import { Schema, model } from "mongoose";

const jobSchema = new Schema(
  {
    // 01 -> Studio & Company Details
    companyName: {
      type: String,
      required: true,
      trim: true,
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
    companySize: {
      type: String,
      trim: true,
      default: "",
    },
    visualAssets: {
      type: [String],
      default: [],
    },

    // 02 -> Role Details
    jobTitle: {
      type: String,
      required: true,
      trim: true,
    },
    jobCategory: {
      type: Schema.Types.ObjectId,
      ref: "jobCategories",
      default: null,
    },
    jobCategories: [
      {
        type: Schema.Types.ObjectId,
        ref: "jobCategories",
      },
    ],
    applicationLink: {
      type: String,
      trim: true,
      default: "",
    },

    // 03 -> Location
    location: {
      type: String,
      trim: true,
      default: "",
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
    currency: {
      type: String,
      default: "$",
    },

    // 04 -> Overview
    overview: {
      type: String,
      default: "",
    },
    allowInternalConnections: {
      type: Boolean,
      default: false,
    },

    // Metadata & Status
    status: {
      type: String,
      enum: ["active", "pending", "rejected", "draft", "archived", "closed"],
      default: "active",
    },
    submitterEmail: {
      type: String,
      trim: true,
      default: "",
    },
    submitterName: {
      type: String,
      trim: true,
      default: "",
    },
    postedBy: {
      type: Schema.Types.ObjectId,
      ref: "user",
      default: null,
    },
    connections: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],
    savedByUsers: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],

    spotLight: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

export const Job = model("job", jobSchema);
