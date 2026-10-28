/**
 * Migration Script: Move existing "pending" jobs to "scraped" status
 *
 * Purpose:
 * - All existing jobs with status="pending" in the database were created by the scraper
 * - We're separating scraper-originated jobs (status="scraped") from manually submitted ones (status="pending")
 * - This script bulk-updates all current pending jobs to the new "scraped" status
 *
 * Usage:
 *   node scripts/migratePendingToScraped.js
 *
 * This is a one-time migration. Safe to re-run (idempotent — only updates pending→scraped).
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI =
  process.env.MONGO_URI || process.env.DB_CONNECTION_STRING || "";

if (!MONGO_URI) {
  console.error(
    "❌ No MONGO_URI or DB_CONNECTION_STRING found in environment variables."
  );
  process.exit(1);
}

async function migrate() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;
    const jobsCollection = db.collection("jobs");

    // Count current pending jobs
    const pendingCount = await jobsCollection.countDocuments({
      status: "pending",
    });
    console.log(`📊 Found ${pendingCount} jobs with status="pending"`);

    if (pendingCount === 0) {
      console.log("✅ No pending jobs to migrate. Already up to date!");
      await mongoose.disconnect();
      process.exit(0);
    }

    // Bulk update: pending → scraped
    const result = await jobsCollection.updateMany(
      { status: "pending" },
      { $set: { status: "scraped" } }
    );

    console.log(
      `✅ Migration complete! Updated ${result.modifiedCount} jobs from "pending" → "scraped"`
    );

    // Verify
    const remainingPending = await jobsCollection.countDocuments({
      status: "pending",
    });
    const newScraped = await jobsCollection.countDocuments({
      status: "scraped",
    });
    console.log(`📊 Verification: pending=${remainingPending}, scraped=${newScraped}`);

    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

migrate();
