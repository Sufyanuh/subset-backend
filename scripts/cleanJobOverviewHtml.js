import mongoose from "mongoose";
import dotenv from "dotenv";
import { Job } from "../model/job.js";
import { atsDetector } from "../services/atsDetector.js";

dotenv.config();

export const cleanAllJobOverviews = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error("MONGO_URI environment variable is not defined");
    }

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Find all jobs that have HTML lists, encoded entities, or malformed tags
    const jobs = await Job.find({
      $or: [
        { overview: { $regex: /<ul|<ol|<li|&lt;|&gt;|href=["']\[|<a\s+[^>]*href=["']<a/i } },
        { aboutCompany: { $regex: /<ul|<ol|<li|&lt;|&gt;|href=["']\[|<a\s+[^>]*href=["']<a/i } },
      ],
    });

    console.log(`Found ${jobs.length} candidate jobs to inspect and clean...`);

    let updatedCount = 0;
    for (const job of jobs) {
      let changed = false;

      if (job.overview) {
        const cleaned = atsDetector.cleanOverview(job.overview);
        if (cleaned !== job.overview) {
          job.overview = cleaned;
          changed = true;
        }
      }

      if (job.aboutCompany) {
        const cleaned = atsDetector.cleanOverview(job.aboutCompany);
        if (cleaned !== job.aboutCompany) {
          job.aboutCompany = cleaned;
          changed = true;
        }
      }

      if (changed) {
        await job.save();
        updatedCount++;
      }
    }

    console.log(`Successfully cleaned and sanitized ${updatedCount} jobs!`);
  } catch (error) {
    console.error("Failed to clean job overviews:", error);
  } finally {
    await mongoose.disconnect();
  }
};

cleanAllJobOverviews();
