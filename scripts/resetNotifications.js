// scripts/resetNotifications.js
import mongoose from "mongoose";
import { Notification } from "../model/notification.js";
import dotenv from "dotenv";

dotenv.config();
const MONGODB_URI = "YOUR_MONGODB_URI_HERE"; // replace with your MongoDB connection string

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    const dec11Start = new Date("2025-12-11T00:00:00Z");
    const dec11End = new Date("2025-12-11T23:59:59Z");

    // 1️⃣ Set Dec 11 notifications to unread + emailSent false
    const dec11Result = await Notification.updateMany(
      { createdAt: { $gte: dec11Start, $lte: dec11End } },
      { $set: { isRead: false, emailSent: false } }
    );
    console.log(
      `🔹 Dec 11 notifications updated: ${dec11Result.modifiedCount}`
    );

    // 2️⃣ Set all other notifications to read + emailSent true
    const otherResult = await Notification.updateMany(
      {
        $or: [
          { createdAt: { $lt: dec11Start } },
          { createdAt: { $gt: dec11End } },
        ],
      },
      { $set: { isRead: true, emailSent: true } }
    );
    console.log(`🔹 Other notifications updated: ${otherResult.modifiedCount}`);

    console.log("✅ Notification reset script completed!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
};

run();
