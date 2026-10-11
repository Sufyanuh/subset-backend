import { Schema, model } from "mongoose";

const scraperSettingsSchema = new Schema(
  {
    isPaused: {
      type: Boolean,
      default: false,
    },
    concurrency: {
      type: Number,
      default: 2,
      min: 1,
      max: 5,
    },
    batchSize: {
      type: Number,
      default: 8,
      min: 1,
      max: 20,
    },
    cooldownSeconds: {
      type: Number,
      default: 4,
      min: 1,
      max: 30,
    },
    domainCooldownSeconds: {
      type: Number,
      default: 2,
      min: 1,
      max: 10,
    },
    lastRunAt: {
      type: Date,
      default: null,
    },
    // Heartbeat tracking to detect stopped / stalled cron jobs
    lastHeartbeatAt: {
      type: Date,
      default: () => new Date(),
    },
    // Optional UTC operating window (e.g., scrape only off-peak hours)
    activeWindowEnabled: {
      type: Boolean,
      default: false,
    },
    startHourUtc: {
      type: Number,
      default: 0, // 00:00 UTC
      min: 0,
      max: 23,
    },
    endHourUtc: {
      type: Number,
      default: 23, // 23:00 UTC
      min: 0,
      max: 23,
    },
    cronIntervalMinutes: {
      type: Number,
      default: 15,
    },
    updatedBy: {
      type: String,
      default: "system",
    },
  },
  {
    timestamps: true,
  }
);

// Singleton helper to get or initialize settings
scraperSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({
      isPaused: false,
      concurrency: 2,
      batchSize: 8,
      cooldownSeconds: 4,
      domainCooldownSeconds: 2,
      updatedBy: "system",
    });
  }
  return settings;
};

export const ScraperSettings = model("ScraperSettings", scraperSettingsSchema);
