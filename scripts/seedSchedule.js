import "dotenv/config";
import mongoose from "mongoose";
import { ConnectMongoDB } from "../connection.js";
import { Studio } from "../model/studio.js";

/**
 * One-time Seeding Script to stagger nextScrapeAt across 1,200+ studios.
 * Prevents the "Thundering Herd" problem by spreading schedules evenly across time.
 *
 * Usage: node scripts/seedSchedule.js
 */
async function seedSchedule() {
  console.log("🚀 Starting Initial Schedule Seeding for Studios...");
  await ConnectMongoDB();

  try {
    const studios = await Studio.find({ isActive: true });
    console.log(`📊 Found ${studios.length} active studio(s) to schedule.`);

    if (studios.length === 0) {
      console.log("No active studios found. Exiting.");
      process.exit(0);
    }

    const now = Date.now();
    const bulkOps = [];
    let dailyCount = 0;
    let weeklyCount = 0;
    let monthlyCount = 0;

    for (const studio of studios) {
      const frequency = studio.scrapingFrequency || "weekly";
      let maxOffsetMs = 7 * 24 * 60 * 60 * 1000; // default weekly = 7 days

      if (frequency === "daily") {
        maxOffsetMs = 24 * 60 * 60 * 1000; // 24 hours
        dailyCount += 1;
      } else if (frequency === "weekly") {
        maxOffsetMs = 7 * 24 * 60 * 60 * 1000; // 7 days
        weeklyCount += 1;
      } else if (frequency === "monthly") {
        maxOffsetMs = 30 * 24 * 60 * 60 * 1000; // 30 days
        monthlyCount += 1;
      }

      // Stagger randomly within the frequency window
      const randomOffset = Math.floor(Math.random() * maxOffsetMs);
      const staggeredNextDate = new Date(now + randomOffset);

      bulkOps.push({
        updateOne: {
          filter: { _id: studio._id },
          update: {
            $set: {
              scrapingFrequency: frequency,
              nextScrapeAt: staggeredNextDate,
              scrapeStatus: "idle",
              failureCount: studio.failureCount || 0,
            },
          },
        },
      });
    }

    if (bulkOps.length > 0) {
      console.log(`⏳ Executing bulk update for ${bulkOps.length} studios...`);
      const res = await Studio.bulkWrite(bulkOps);
      console.log(`✅ Bulk update completed! Modified: ${res.modifiedCount}`);
    }

    console.log("\n📈 Schedule Distribution Breakdown:");
    console.log(`  - Daily studios (spread over 24h): ${dailyCount}`);
    console.log(`  - Weekly studios (spread over 7d):  ${weeklyCount}`);
    console.log(`  - Monthly studios (spread over 30d): ${monthlyCount}`);
    console.log("\n🎉 All studios staggered successfully! No thundering herd on Day 1.");
  } catch (err) {
    console.error("❌ Error seeding schedule:", err);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB.");
    process.exit(0);
  }
}

seedSchedule();
