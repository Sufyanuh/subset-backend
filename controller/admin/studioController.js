import { Studio } from "../../model/studio.js";
import { Job } from "../../model/job.js";
import { studioImportService } from "../../services/studioImportService.js";
import { scraperEngine } from "../../services/scraperEngine.js";
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

