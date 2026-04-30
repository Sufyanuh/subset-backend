import jwt from "jsonwebtoken";
import { User } from "../model/user.js";
import { adminAuth } from "../model/admin.js";

export const generateAuthToken = (payload = {}) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

export const verifyToken = async (token, type) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded?._id) return null;

    if (type === "admin") {
      const admin = await adminAuth.findById(decoded._id).lean();
      return admin || null;
    }

    const user = await User.findById(decoded._id).lean();
    return user || null;
  } catch (error) {
    console.error("JWT Verify Error:", error.message);
    return null;
  }
};
