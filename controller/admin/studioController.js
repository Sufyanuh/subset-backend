import { Studio } from "../../model/studio.js";
import { Job } from "../../model/job.js";
import { ScraperSettings } from "../../model/scraperSettings.js";
import { studioImportService } from "../../services/studioImportService.js";
import { scraperEngine } from "../../services/scraperEngine.js";
import { scrapeScheduler } from "../../services/scrapeScheduler.js";
import { atsDetector } from "../../services/atsDetector.js";
import { logger } from "../../utils/logger.js";

/**
 * Controller for Studio Ingestion & 2-Tier AI Scraping Pipeline
 */

/**
 * Bulk import studios from CSV / Excel file upload or JSON payload
 * POST /api/admin/studios/import
 */
export const importStudios = async (req, res) => {
  try {
    let result;

    if (req.file && req.file.buffer) {
      // 1. File Upload (CSV / XLSX / XLS)
      result = await studioImportService.importStudios(req.file.buffer);
    } else if (req.body && Array.isArray(req.body.studios)) {
      // 2. Direct JSON Array
      result = await studioImportService.importStudios(req.body.studios);
    } else {
      return res.status(400).json({
        success: false,
        message: "Please upload a CSV / Excel file or provide a 'studios' array in request body.",
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    logger.error("Error importing studios", error);
    return res.status(500).json({
      success: false,
      message: "Failed to import studios",
      error: error.message,
    });
  }
};

/**
 * List studios with search, pagination, and filters
 * GET /api/admin/studios
 */
export const getStudios = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      search = "",
      atsType = "",
      status = "",
      frequency = "",
      scrapeStatus = "",
      isActive,
    } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { careersUrl: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
      ];
    }

    if (atsType) {
      query.atsType = atsType;
    }

    if (status) {
      query["scrapingConfig.status"] = status;
    }

    if (frequency) {
      query.scrapingFrequency = frequency;
    }

    if (scrapeStatus) {
      query.scrapeStatus = scrapeStatus;
    }

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [studios, total] = await Promise.all([
      Studio.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Studio.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: studios,
      pagination: {
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
        limit: limitNum,
      },
    });
  } catch (error) {
    logger.error("Error fetching studios", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch studios",
      error: error.message,
    });
  }
};

/**
 * Get single studio by ID
 * GET /api/admin/studios/:id
 */
export const getStudioById = async (req, res) => {
  try {
    const studio = await Studio.findById(req.params.id);
    if (!studio) {
      return res.status(404).json({ success: false, message: "Studio not found" });
    }

    return res.status(200).json({ success: true, data: studio });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Create a single studio manually
 * POST /api/admin/studios
 */
export const createStudio = async (req, res) => {
  try {
    const {
      name,
      careersUrl,
      website,
      location,
      disciplines,
      scrapeImmediately = false,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Studio name is required" });
    }
    if (!careersUrl || !careersUrl.trim()) {
      return res.status(400).json({ success: false, message: "Careers URL is required" });
    }

    const normalized = studioImportService.normalizeRow({
      name,
      careersUrl,
      website,
      location,
      disciplines,
    });

    if (!normalized) {
      return res.status(400).json({ success: false, message: "Invalid studio data provided" });
    }

    // Check if studio with this careers URL already exists
    const existing = await Studio.findOne({ careersUrl: normalized.careersUrl });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `A studio with this careers URL already exists: '${existing.name}'`,
      });
    }

    const studio = new Studio(normalized);
    await studio.save();

    let scrapeResult = null;
    if (scrapeImmediately) {
      try {
        scrapeResult = await scraperEngine.scrapeStudio(studio);
      } catch (scrapeErr) {
        logger.warn(`Failed immediate scrape for newly created studio ${studio.name}`, scrapeErr);
      }
    }

    return res.status(201).json({
      success: true,
      message: `Studio '${studio.name}' created successfully`,
      data: studio,
      scrapeResult,
    });
  } catch (error) {
    logger.error("Error creating studio", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create studio",
      error: error.message,
    });
  }
};

/**
 * Update a single studio
 * PUT /api/admin/studios/:id
 */
export const updateStudio = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, careersUrl, website, location, disciplines, isActive } = req.body;

    const studio = await Studio.findById(id);
    if (!studio) {
      return res.status(404).json({ success: false, message: "Studio not found" });
    }

    if (name && name.trim()) studio.name = name.trim();
    if (location !== undefined) studio.location = String(location).trim();
    if (isActive !== undefined) studio.isActive = Boolean(isActive);

    if (Array.isArray(disciplines)) {
      studio.disciplines = disciplines.map((d) => String(d).trim()).filter(Boolean);
    } else if (typeof disciplines === "string") {
      studio.disciplines = disciplines
        .split(/[,;|]/)
        .map((d) => d.trim())
        .filter(Boolean);
    }

    if (website !== undefined) {
      studio.website = website ? studioImportService.formatUrl(website) : "";
    }

    if (careersUrl && careersUrl.trim()) {
      const formattedCareersUrl = studioImportService.formatUrl(careersUrl);
      if (formattedCareersUrl !== studio.careersUrl) {
        const existing = await Studio.findOne({
          careersUrl: formattedCareersUrl,
          _id: { $ne: studio._id },
        });
        if (existing) {
          return res.status(409).json({
            success: false,
            message: `Another studio with this careers URL already exists: '${existing.name}'`,
          });
        }
        studio.careersUrl = formattedCareersUrl;

        // Re-detect ATS
        const { atsType, atsIdentifier } = atsDetector.detectAts(formattedCareersUrl);
        studio.atsType = atsType;
        studio.atsIdentifier = atsIdentifier;
        if (atsType !== "custom" && atsType !== "unknown") {
          studio.scrapingConfig.status = "discovered";
        }
      }
    }

    await studio.save();

    return res.status(200).json({
      success: true,
      message: `Studio '${studio.name}' updated successfully`,
      data: studio,
    });
  } catch (error) {
    logger.error("Error updating studio", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update studio",
      error: error.message,
    });
  }
};

/**
 * Trigger scrape for a single studio
 * POST /api/admin/studios/:id/scrape
 */
export const scrapeSingleStudio = async (req, res) => {
  try {
    const { id } = req.params;
    const { forceAiDiscovery = false } = req.body;

    const result = await scraperEngine.scrapeStudio(id, { forceAiDiscovery });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    logger.error("Error executing single studio scrape", error);
    return res.status(500).json({
      success: false,
      message: "Failed to scrape studio",
      error: error.message,
    });
  }
};

/**
 * Trigger batch scraping across studios
 * POST /api/admin/studios/scrape-all
 */
export const scrapeAllStudios = async (req, res) => {
  try {
    const { concurrency = 3, forceAiDiscovery = false, filter = {} } = req.body;

    // Run batch scraping
    const result = await scraperEngine.scrapeAllStudios(filter, {
      concurrency: Math.min(10, Math.max(1, concurrency)),
      forceAiDiscovery,
    });

    return res.status(200).json(result);
  } catch (error) {
    logger.error("Error executing batch scraping", error);
    return res.status(500).json({
      success: false,
      message: "Batch scraping failed",
      error: error.message,
    });
  }
};

/**
 * Get high-level scraper & studio statistics
 * GET /api/admin/studios/stats
 */
export const getScraperStats = async (req, res) => {
  try {
    const [totalStudios, atsBreakdown, statusBreakdown, totalScrapedJobs, pendingJobsCount] =
      await Promise.all([
        Studio.countDocuments({}),
        Studio.aggregate([
          { $group: { _id: "$atsType", count: { $sum: 1 } } },
        ]),
        Studio.aggregate([
          { $group: { _id: "$scrapingConfig.status", count: { $sum: 1 } } },
        ]),
        Job.countDocuments({}),
        Job.countDocuments({ status: "pending" }),
      ]);

    const atsMap = {};
    for (const item of atsBreakdown) {
      atsMap[item._id || "unknown"] = item.count;
    }

    const statusMap = {};
    for (const item of statusBreakdown) {
      statusMap[item._id || "active"] = item.count;
    }

    return res.status(200).json({
      success: true,
      stats: {
        totalStudios,
        atsBreakdown: atsMap,
        statusBreakdown: statusMap,
        totalScrapedJobs,
        pendingJobsCount,
      },
    });
  } catch (error) {
    logger.error("Error fetching scraper stats", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch stats",
      error: error.message,
    });
  }
};

/**
 * Delete all studios
 * DELETE /api/admin/studios
 */
export const clearAllStudios = async (req, res) => {
  try {
    const result = await Studio.deleteMany({});
    return res.status(200).json({
      success: true,
      message: `All studios (${result.deletedCount}) deleted successfully.`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    logger.error("Error clearing all studios", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete a studio
 * DELETE /api/admin/studios/:id
 */
export const deleteStudio = async (req, res) => {
  try {
    const { id } = req.params;
    const studio = await Studio.findByIdAndDelete(id);
    if (!studio) {
      return res.status(404).json({ success: false, message: "Studio not found" });
    }

    return res.status(200).json({
      success: true,
      message: `Studio '${studio.name}' deleted successfully.`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get jobs for a specific studio (by ID or studio name fallback)
 * GET /api/admin/studios/:id/jobs
 */
export const getStudioJobs = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, page = 1, limit = 50 } = req.query;

    const studio = await Studio.findById(id);
    if (!studio) {
      return res.status(404).json({ success: false, message: "Studio not found" });
    }

    const query = {
      $or: [
        { studio: id },
        { companyName: studio.name },
      ],
    };

    if (status && status !== "all") {
      query.status = status;
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [jobs, total, pendingCount, activeCount, rejectedCount] = await Promise.all([
      Job.find(query)
        .populate("jobCategory", "name")
        .populate("jobCategories", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Job.countDocuments(query),
      Job.countDocuments({ ...query, status: "pending" }),
      Job.countDocuments({ ...query, status: "active" }),
      Job.countDocuments({ ...query, status: "rejected" }),
    ]);

    return res.status(200).json({
      success: true,
      studio: {
        _id: studio._id,
        name: studio.name,
        logo: studio.logo,
        favicon: studio.favicon,
        careersUrl: studio.careersUrl,
        website: studio.website,
        atsType: studio.atsType,
      },
      counts: {
        total,
        pending: pendingCount,
        active: activeCount,
        rejected: rejectedCount,
      },
      data: jobs,
      pagination: {
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
        limit: limitNum,
      },
    });
  } catch (error) {
    logger.error("Error fetching jobs for studio", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update scraping frequency for a studio
 * PATCH /api/admin/studios/:id/frequency
 */
export const updateStudioFrequency = async (req, res) => {
  try {
    const { id } = req.params;
    const { frequency } = req.body;

    if (!["daily", "weekly", "monthly"].includes(frequency)) {
      return res.status(400).json({
        success: false,
        message: "Invalid frequency. Must be 'daily', 'weekly', or 'monthly'.",
      });
    }

    const studio = await Studio.findById(id);
    if (!studio) {
      return res.status(404).json({ success: false, message: "Studio not found" });
    }

    studio.scrapingFrequency = frequency;
    // Recalculate next run date based on new frequency
    studio.nextScrapeAt = scrapeScheduler.calculateNextScrapeDate(frequency, new Date());
    await studio.save();

    return res.status(200).json({
      success: true,
      message: `Updated scraping frequency for '${studio.name}' to ${frequency}.`,
      data: {
        _id: studio._id,
        name: studio.name,
        scrapingFrequency: studio.scrapingFrequency,
        nextScrapeAt: studio.nextScrapeAt,
      },
    });
  } catch (error) {
    logger.error("Error updating studio frequency", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Manually queue a studio for immediate scrape
 * POST /api/admin/studios/:id/run-now
 */
export const runStudioNow = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await scrapeScheduler.runStudioNow(id);
    return res.status(200).json(result);
  } catch (error) {
    logger.error("Error running studio now", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Reset a studio with 'failed_needs_review' back to 'idle'
 * POST /api/admin/studios/:id/reset
 */
export const resetStudio = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await scrapeScheduler.resetStudio(id);
    return res.status(200).json(result);
  } catch (error) {
    logger.error("Error resetting studio", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get automated scraping pipeline status, counts, and settings
 * GET /api/admin/studios/scraping/status
 */
export const getScrapingStatus = async (req, res) => {
  try {
    const now = new Date();
    const settings = await ScraperSettings.getSettings();

    const [
      totalActive,
      dueCount,
      scrapingCount,
      failedNeedsReviewCount,
      dailyCount,
      weeklyCount,
      monthlyCount,
      recentScraped,
    ] = await Promise.all([
      Studio.countDocuments({ isActive: true }),
      Studio.countDocuments({
        isActive: true,
        scrapeStatus: "idle",
        nextScrapeAt: { $lte: now },
      }),
      Studio.countDocuments({ scrapeStatus: "scraping" }),
      Studio.countDocuments({ scrapeStatus: "failed_needs_review" }),
      Studio.countDocuments({ isActive: true, scrapingFrequency: "daily" }),
      Studio.countDocuments({ isActive: true, scrapingFrequency: "weekly" }),
      Studio.countDocuments({ isActive: true, scrapingFrequency: "monthly" }),
      Studio.find({ lastScrapedAt: { $ne: null } })
        .sort({ lastScrapedAt: -1 })
        .limit(10)
        .select("name careersUrl lastScrapedAt lastScrapeResult lastError failureCount scrapingFrequency")
        .lean(),
    ]);

    // Heartbeat check: Cron runs every 15 mins. If lastHeartbeatAt was more than 35 mins ago, cron is likely dead/stopped.
    const lastHeartbeat = settings.lastHeartbeatAt ? new Date(settings.lastHeartbeatAt).getTime() : 0;
    const minutesSinceHeartbeat = lastHeartbeat ? Math.round((Date.now() - lastHeartbeat) / 60000) : null;
    const isCronHealthy = minutesSinceHeartbeat !== null && minutesSinceHeartbeat <= 35;

    return res.status(200).json({
      success: true,
      data: {
        cronHealth: {
          isHealthy: isCronHealthy,
          lastHeartbeatAt: settings.lastHeartbeatAt,
          minutesSinceHeartbeat,
          status: isCronHealthy ? "running" : "stopped",
        },
        settings: {
          isPaused: settings.isPaused,
          concurrency: settings.concurrency,
          batchSize: settings.batchSize,
          cooldownSeconds: settings.cooldownSeconds,
          lastRunAt: settings.lastRunAt,
          activeWindowEnabled: settings.activeWindowEnabled || false,
          startHourUtc: settings.startHourUtc ?? 0,
          endHourUtc: settings.endHourUtc ?? 23,
          cronIntervalMinutes: settings.cronIntervalMinutes || 15,
        },
        counts: {
          totalActive,
          dueCount,
          scrapingCount,
          failedNeedsReviewCount,
          byFrequency: {
            daily: dailyCount,
            weekly: weeklyCount,
            monthly: monthlyCount,
          },
        },
        recentScraped,
      },
    });
  } catch (error) {
    logger.error("Error getting scraping status", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update scraper settings (operating UTC window, batch size, concurrency)
 * PUT /api/admin/studios/scraping/settings
 */
export const updateScraperSettings = async (req, res) => {
  try {
    const {
      activeWindowEnabled,
      startHourUtc,
      endHourUtc,
      batchSize,
      concurrency,
      cooldownSeconds,
    } = req.body;

    const settings = await ScraperSettings.getSettings();

    if (activeWindowEnabled !== undefined) {
      settings.activeWindowEnabled = Boolean(activeWindowEnabled);
    }
    if (startHourUtc !== undefined) {
      settings.startHourUtc = Math.min(23, Math.max(0, parseInt(startHourUtc, 10)));
    }
    if (endHourUtc !== undefined) {
      settings.endHourUtc = Math.min(23, Math.max(0, parseInt(endHourUtc, 10)));
    }
    if (batchSize !== undefined) {
      settings.batchSize = Math.min(20, Math.max(1, parseInt(batchSize, 10)));
    }
    if (concurrency !== undefined) {
      settings.concurrency = Math.min(5, Math.max(1, parseInt(concurrency, 10)));
    }
    if (cooldownSeconds !== undefined) {
      settings.cooldownSeconds = Math.min(30, Math.max(1, parseInt(cooldownSeconds, 10)));
    }

    settings.updatedBy = req.user?.email || "admin";
    await settings.save();

    return res.status(200).json({
      success: true,
      message: "Scraper settings updated successfully.",
      data: settings,
    });
  } catch (error) {
    logger.error("Error updating scraper settings", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Ping / refresh cron heartbeat & trigger batch run
 * POST /api/admin/studios/scraping/ping
 */
export const pingCronHeartbeat = async (req, res) => {
  try {
    const settings = await ScraperSettings.getSettings();
    settings.lastHeartbeatAt = new Date();
    await settings.save();

    // Trigger batch in background
    setImmediate(() => {
      scrapeScheduler.runBatch().catch((err) => logger.error("Ping runBatch error:", err));
    });

    return res.status(200).json({
      success: true,
      message: "Cron heartbeat refreshed and batch run triggered.",
      lastHeartbeatAt: settings.lastHeartbeatAt,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Toggle global pause on automated scraping
 * POST /api/admin/studios/scraping/pause
 * POST /api/admin/studios/scraping/resume
 */
export const toggleScrapingPause = async (req, res) => {
  try {
    const isPaused = req.path.endsWith("/pause");
    const settings = await ScraperSettings.getSettings();
    settings.isPaused = isPaused;
    settings.updatedBy = req.user?.email || "admin";
    await settings.save();

    return res.status(200).json({
      success: true,
      message: `Automated scraping ${isPaused ? "PAUSED" : "RESUMED"} successfully.`,
      isPaused: settings.isPaused,
    });
  } catch (error) {
    logger.error("Error toggling scraping pause", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Manually trigger a scheduler batch run immediately
 * POST /api/admin/studios/scraping/run-batch
 */
export const triggerManualBatch = async (req, res) => {
  try {
    // Run in background and return immediate acknowledgement
    setImmediate(async () => {
      try {
        await scrapeScheduler.runBatch();
      } catch (err) {
        logger.error("Error running manual batch:", err);
      }
    });

    return res.status(200).json({
      success: true,
      message: "Scraping batch run triggered in background.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};



