import { Schema, model } from "mongoose";
const adminSchema = Schema({
  name: {
    type: String,
    required: true,
    default: "admin",
  },
  password: { type: String, required: true, default: "12345678" },
  email: {
    type: String,
    required: true,
    unique: true,
    default: "admin@subset.com",
  },
  token: { type: String, default: null },
});

export const adminAuth = model("admins", adminSchema);
