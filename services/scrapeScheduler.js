import { Studio } from "../model/studio.js";
import { ScraperSettings } from "../model/scraperSettings.js";
import { scraperEngine } from "./scraperEngine.js";
import { logger } from "../utils/logger.js";

/**
 * Production-grade Automated Scrape Scheduler
 * Implements:
 * - Atomic claiming via findOneAndUpdate
 * - Worker pool concurrency control (default: 2)
 * - Stale-lock crash recovery (15 min cutoff)
 * - Per-domain rate limit throttling
 * - Error categorization (permanent, blocked, temporary) with exponential backoff
 * - Jittered scheduling (+-15 min anti-collision)
 */
class ScrapeScheduler {
  constructor() {
    this.isProcessing = false;
    this.domainLastHit = new Map(); // domain -> timestamp
  }

  /**
   * Main batch executor triggered by cron or manual run
   */
  async runBatch() {
    if (this.isProcessing) {
      logger.info("[Scheduler] Batch execution skipped: Previous batch still running.");
      return { skipped: true, reason: "already_running" };
    }

    this.isProcessing = true;
    const batchStartTime = Date.now();

    try {
      // 1. Check Global Pause Switch
      const settings = await ScraperSettings.getSettings();
      if (settings.isPaused) {
        logger.info("[Scheduler] Scraping is paused globally. Skipping batch.");
        return { skipped: true, reason: "paused" };
      }

      // 2. Recover Stale Locks (crashed workers / hung processes)
      await this.recoverStaleLocks();

      // 3. Process up to batchSize studios using Worker Pool
      const batchSize = settings.batchSize || 8;
      const concurrency = settings.concurrency || 2;
      const cooldownMs = (settings.cooldownSeconds || 4) * 1000;
      const domainCooldownMs = (settings.domainCooldownSeconds || 2) * 1000;

      let processedCount = 0;
      let successCount = 0;
      let failedCount = 0;

      logger.info(
        `[Scheduler] Starting batch run (batchSize: ${batchSize}, concurrency: ${concurrency})`
      );

      // Worker function that claims and processes studios sequentially
      const worker = async (workerId) => {
        while (processedCount < batchSize) {
          // Check global pause dynamically
          const currentSettings = await ScraperSettings.getSettings();
          if (currentSettings.isPaused) {
            logger.info(`[Scheduler Worker ${workerId}] Scraping paused mid-batch.`);
            break;
          }

          // Atomically claim the next due studio
          const studio = await this.claimNextStudio();
          if (!studio) {
            // No more due studios available
            break;
          }

          processedCount += 1;
          logger.info(
            `[Scheduler Worker ${workerId}] Claimed studio: ${studio.name} (${processedCount}/${batchSize})`
          );

          try {
            // Apply per-domain politeness
            await this.applyDomainPoliteness(studio, domainCooldownMs);

            // Execute scrape with hard 3-minute timeout
            const scrapeResult = await this.executeWithTimeout(
              () => scraperEngine.scrapeStudio(studio),
              180000 // 3 minutes
            );

            if (scrapeResult && scrapeResult.success) {
              await this.handleSuccess(studio);
              successCount += 1;
            } else {
              const errMsg = scrapeResult?.error || scrapeResult?.message || "Unknown scrape error";
              await this.handleFailure(studio, new Error(errMsg));
              failedCount += 1;
            }
          } catch (err) {
            logger.error(`[Scheduler Worker ${workerId}] Error scraping ${studio.name}:`, err.message);
            await this.handleFailure(studio, err);
            failedCount += 1;
          }

          // Cool-off delay between studios on this worker
          if (cooldownMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, cooldownMs));
          }
        }
      };

      // Launch parallel workers
      const workers = [];
      for (let i = 1; i <= concurrency; i++) {
        workers.push(worker(i));
      }
      await Promise.all(workers);

      // Update settings with last run time
      settings.lastRunAt = new Date();
      await settings.save();

      const durationMs = Date.now() - batchStartTime;
      logger.info(
        `[Scheduler] Batch completed in ${durationMs}ms. Processed: ${processedCount}, Success: ${successCount}, Failed: ${failedCount}`
      );

      return {
        processedCount,
        successCount,
        failedCount,
        durationMs,
      };
    } catch (error) {
      logger.error("[Scheduler] Batch execution encountered fatal error:", error);
      return { error: error.message };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Atomically claims the oldest due studio using findOneAndUpdate
   */
  async claimNextStudio() {
    const now = new Date();
    return Studio.findOneAndUpdate(
      {
        isActive: true,
        scrapeStatus: "idle",
        nextScrapeAt: { $lte: now },
      },
      {
        $set: {
          scrapeStatus: "scraping",
          lastStartedAt: now,
        },
      },
      {
        sort: { nextScrapeAt: 1 },
        new: true,
      }
    );
  }

  /**
   * Recovers studios stuck in 'scraping' state due to server restart or timeout
   */
  async recoverStaleLocks() {
    const staleCutoff = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago
    const result = await Studio.updateMany(
      {
        scrapeStatus: "scraping",
        lastStartedAt: { $lt: staleCutoff },
      },
      {
        $set: {
          scrapeStatus: "idle",
          lastError: "Recovered from stale scraping lock (timeout or server restart)",
        },
      }
    );

    if (result.modifiedCount > 0) {
      logger.warn(`[Scheduler] Recovered ${result.modifiedCount} stale locked studio(s).`);
    }
  }

  /**
   * Enforces delay if the same domain was recently scraped
   */
  async applyDomainPoliteness(studio, domainCooldownMs) {
    try {
      const urlStr = studio.careersUrl || studio.website || "";
      if (!urlStr) return;

      const domain = new URL(urlStr).hostname.toLowerCase();
      const lastHit = this.domainLastHit.get(domain);

      if (lastHit) {
        const elapsed = Date.now() - lastHit;
        if (elapsed < domainCooldownMs) {
          const waitTime = domainCooldownMs - elapsed;
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }

      this.domainLastHit.set(domain, Date.now());
    } catch {
      // Ignore URL parse errors
    }
  }

  /**
   * Wraps an async function in a hard timeout
   */
  async executeWithTimeout(asyncFn, timeoutMs) {
    return Promise.race([
      asyncFn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Scrape timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      ),
    ]);
  }

  /**
   * Updates studio on successful scrape
   */
  async handleSuccess(studio) {
    const now = new Date();
    const frequency = studio.scrapingFrequency || "weekly";
    const nextScrapeAt = this.calculateNextScrapeDate(frequency, now);

    studio.lastScrapedAt = now;
    studio.lastScrapeResult = "success";
    studio.scrapeStatus = "idle";
    studio.failureCount = 0;
    studio.lastError = "";
    studio.lastErrorType = null;
    studio.nextScrapeAt = nextScrapeAt;

    await studio.save();
    logger.info(`[Scheduler] ${studio.name} scrape succeeded. Next scrape at: ${nextScrapeAt.toISOString()}`);
  }

  /**
   * Categorizes error and applies smart retry / backoff
   */
  async handleFailure(studio, error) {
    const now = new Date();
    const failureCount = (studio.failureCount || 0) + 1;
    const errorType = this.classifyError(error);

    studio.lastScrapeResult = "failed";
    studio.failureCount = failureCount;
    studio.lastError = (error.message || String(error)).substring(0, 500);
    studio.lastErrorType = errorType;

    let nextScrapeAt = now;
    let newStatus = "idle";

    if (errorType === "blocked") {
      // 429 / 403 / Cloudflare -> 24 hours mandatory rest
      nextScrapeAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      if (failureCount >= 3) {
        newStatus = "failed_needs_review";
      }
    } else if (errorType === "permanent") {
      // 404 / Dead domain -> 2 consecutive fails flags for review
      if (failureCount >= 2) {
        newStatus = "failed_needs_review";
        nextScrapeAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Put far in future
      } else {
        nextScrapeAt = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12 hour re-check
      }
    } else {
      // Temporary error (5xx, timeout, network glitch) -> Exponential backoff
      let backoffHours = 6;
      if (failureCount === 2) backoffHours = 12;
      else if (failureCount === 3) backoffHours = 24;
      else if (failureCount >= 4) backoffHours = 48;

      if (failureCount >= 5) {
        newStatus = "failed_needs_review";
      } else {
        nextScrapeAt = new Date(now.getTime() + backoffHours * 60 * 60 * 1000);
      }
    }

    studio.scrapeStatus = newStatus;
    studio.nextScrapeAt = nextScrapeAt;

    await studio.save();
    logger.warn(
      `[Scheduler] ${studio.name} scrape failed (Type: ${errorType}, Failures: ${failureCount}, NewStatus: ${newStatus}). Next: ${nextScrapeAt.toISOString()}`
    );
  }

  /**
   * Classifies error into permanent, blocked, or temporary
   */
  classifyError(error) {
    const msg = (error?.message || "").toLowerCase();
    const status = error?.response?.status || error?.status;

    if (status === 429 || status === 403 || msg.includes("rate limit") || msg.includes("captcha") || msg.includes("cloudflare") || msg.includes("blocked")) {
      return "blocked";
    }

    if (
      status === 404 ||
      status === 410 ||
      msg.includes("getaddrinfo") ||
      msg.includes("eai_again") ||
      msg.includes("enotfound") ||
      msg.includes("err_name_not_resolved")
    ) {
      return "permanent";
    }

    return "temporary";
  }

  /**
   * Calculates next scrape date with +-15 mins random jitter to prevent collisions
   */
  calculateNextScrapeDate(frequency, baseDate = new Date()) {
    let intervalMs = 7 * 24 * 60 * 60 * 1000; // default weekly

    if (frequency === "daily") {
      intervalMs = 24 * 60 * 60 * 1000;
    } else if (frequency === "weekly") {
      intervalMs = 7 * 24 * 60 * 60 * 1000;
    } else if (frequency === "monthly") {
      intervalMs = 30 * 24 * 60 * 60 * 1000;
    }

    // Jitter: random between -15 and +15 minutes
    const jitterMs = (Math.floor(Math.random() * 31) - 15) * 60 * 1000;
    return new Date(baseDate.getTime() + intervalMs + jitterMs);
  }

  /**
   * Manual trigger for a single studio (Run Now)
   */
  async runStudioNow(studioId) {
    const studio = await Studio.findById(studioId);
    if (!studio) {
      throw new Error("Studio not found");
    }

    // Mark studio as due immediately
    studio.nextScrapeAt = new Date();
    studio.scrapeStatus = "idle";
    await studio.save();

    // Trigger batch runner in background
    setImmediate(() => {
      this.runBatch().catch((err) => logger.error("[Scheduler] Background runBatch error:", err));
    });

    return { success: true, message: `Studio "${studio.name}" queued for immediate scrape.` };
  }

  /**
   * Reset a failed studio back to idle
   */
  async resetStudio(studioId) {
    const studio = await Studio.findById(studioId);
    if (!studio) {
      throw new Error("Studio not found");
    }

    studio.scrapeStatus = "idle";
    studio.failureCount = 0;
    studio.lastError = "";
    studio.lastErrorType = null;
    studio.nextScrapeAt = new Date();
    await studio.save();

    return { success: true, message: `Studio "${studio.name}" reset to idle and queued.` };
  }
}

export const scrapeScheduler = new ScrapeScheduler();
