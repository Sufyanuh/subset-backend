import { Schema, model } from "mongoose";

const mentorSchema = new Schema(
  {
    fullName: { type: String, required: true },
    tags: {
      type: [String],
      required: true,
      default: ["hello", "hi", "whatsUp"],
    },
    founder: { type: String, required: true, default: "Abc" },
    avatar: { type: String, default: null, required: true },
    email: { type: String, required: true, unique: true },
    calendlyUrl: { type: String, default: null },
    description: { type: String, default: null },
    website: { type: String, default: null },
    instagram: { type: String, default: null },
    linkedin: { type: String, default: null },
    services: {
      type: [String],
      enum: [
        "Mentorship",
        "1:1 Coaching",
        "Portfolio Review",
        "Recruiter Connect",
        "Academic Counseling",
        "Choose Your Topic",
      ],
    },
  },
  { timestamps: true }
);

export const Mentor = model("mentor", mentorSchema);
