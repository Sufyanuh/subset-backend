import cron from "node-cron";
import { ScraperSettings } from "../model/scraperSettings.js";
import { scrapeScheduler } from "../services/scrapeScheduler.js";
import { logger } from "../utils/logger.js";

/**
 * Production Automated Scraper Cron Job
 * Runs every 15 minutes to process due studios in bounded batches
 */
export const setupStudioScraperCron = () => {
  // Runs every 15 minutes: at :00, :15, :30, :45
  cron.schedule("*/15 * * * *", async () => {
    logger.cron("⏰ Triggering Automated Studio Scraper Cron (Every 15 mins)...");
    try {
      // 1. Record Heartbeat (Dead man's switch detection)
      await ScraperSettings.updateOne({}, { $set: { lastHeartbeatAt: new Date() } });

      // 2. Check UTC Operating Window (if configured by admin)
      const settings = await ScraperSettings.getSettings();
      if (settings.activeWindowEnabled) {
        const currentUtcHour = new Date().getUTCHours();
        const start = settings.startHourUtc ?? 0;
        const end = settings.endHourUtc ?? 23;

        let isInsideWindow = false;
        if (start <= end) {
          isInsideWindow = currentUtcHour >= start && currentUtcHour <= end;
        } else {
          // Window spans midnight, e.g., 22:00 to 05:00 UTC
          isInsideWindow = currentUtcHour >= start || currentUtcHour <= end;
        }

        if (!isInsideWindow) {
          logger.cron(
            `⏸️ [Scheduler Cron] Current time (${currentUtcHour}:00 UTC) is outside configured operating window (${start}:00 - ${end}:00 UTC). Skipping batch.`
          );
          return;
        }
      }

      const summary = await scrapeScheduler.runBatch();
      if (summary && !summary.skipped) {
        logger.cron(
          `✅ Automated Studio Scraper Batch Finished. Processed: ${summary.processedCount}, Success: ${summary.successCount}, Failed: ${summary.failedCount}`
        );
      }
    } catch (err) {
      logger.error(`❌ Automated Studio Scraper Cron Error: ${err.message}`, err);
    }
  });

  logger.info("📅 Studio Scraper Cron Scheduled (Every 15 minutes: */15 * * * *)");
};
