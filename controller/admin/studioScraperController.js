import xlsx from "xlsx";
import { MonitoredStudio } from "../../model/monitoredStudio.js";
import { DetectedJob } from "../../model/detectedJob.js";
import { Job } from "../../model/job.js";
import { JobCategory } from "../../model/jobCategory.js";
import { changedetectionService } from "../../services/changedetectionService.js";
import { logger } from "../../utils/logger.js";

/**
 * Upload and parse CSV to import studios
 * Expects columns: Studio, URL, Location, Disciplines
 */
export const importStudiosCsv = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Please upload a CSV or Excel file." });
    }

    // Read buffer using xlsx
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = xlsx.utils.sheet_to_json(worksheet);

    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({ message: "The uploaded file is empty." });
    }

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    const studiosToProcess = [];

    for (const row of rawRows) {
      // Find matching keys flexibly
      const studioName =
        row["Studio"] || row["studio"] || row["Name"] || row["Company"] || "";
      let url = row["URL"] || row["url"] || row["Website"] || row["website"] || "";
      const location = row["Location"] || row["location"] || "";
      const disciplinesRaw =
        row["Disciplines"] || row["disciplines"] || row["Categories"] || "";

      if (!studioName || !url) {
        skippedCount++;
        continue;
      }

      url = String(url).trim();
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = `https://${url}`;
      }

      const disciplines =
        typeof disciplinesRaw === "string"
          ? disciplinesRaw
              .split(",")
              .map((d) => d.trim())
              .filter(Boolean)
          : Array.isArray(disciplinesRaw)
          ? disciplinesRaw
          : [];

      studiosToProcess.push({
        name: String(studioName).trim(),
        website: url,
        targetUrl: url,
        location: String(location).trim(),
        disciplines,
      });
    }

    // Bulk upsert in database
    const bulkOps = studiosToProcess.map((item) => ({
      updateOne: {
        filter: { targetUrl: item.targetUrl },
        update: {
          $set: {
            name: item.name,
            website: item.website,
            location: item.location,
            disciplines: item.disciplines,
            isActive: true,
          },
        },
        upsert: true,
      },
    }));

    if (bulkOps.length > 0) {
      const result = await MonitoredStudio.bulkWrite(bulkOps);
      importedCount = result.upsertedCount || 0;
      updatedCount = result.modifiedCount || 0;
    }

    // Background job: Register unregistered studios with changedetection.io
    syncStudiosWithChangedetectionBackground();

    return res.status(200).json({
      message: `Successfully processed ${studiosToProcess.length} studios.`,
      stats: {
        totalParsed: rawRows.length,
        newStudios: importedCount,
        updatedStudios: updatedCount,
        skipped: skippedCount,
      },
    });
  } catch (error) {
    logger.error("Error importing studios CSV", error);
    return res.status(500).json({
      message: "Failed to import CSV",
      error: error.message,
    });
  }
};

/**
 * Background sync function for changedetection watches
 */
async function syncStudiosWithChangedetectionBackground() {
  if (!changedetectionService.isConfigured()) {
    logger.info("Changedetection service not configured; skipping API watch creation.");
    return;
  }

  try {
    // Find all studios that are not yet registered with changedetection
    const pendingStudios = await MonitoredStudio.find({
      changedetectionUuid: { $in: [null, ""] },
      isActive: true,
    }).limit(100); // Process in batches of 100

    if (pendingStudios.length === 0) return;

    logger.info(`Starting changedetection background sync for ${pendingStudios.length} studios...`);

    // Fetch categories for trigger keywords
    const categories = await JobCategory.find({}).select("name");
    const triggerWords = categories.map((c) => c.name).filter(Boolean);

    for (const studio of pendingStudios) {
      try {
        const result = await changedetectionService.createWatch({
          url: studio.targetUrl,
          title: studio.name,
          tag: "studio",
          triggerWords,
        });

        if (result.success && result.uuid) {
          studio.changedetectionUuid = result.uuid;
          studio.changedetectionStatus = "registered";
          studio.lastError = "";
        } else {
          studio.changedetectionStatus = "error";
          studio.lastError = result.error || "Failed to create watch";
        }
        await studio.save();

        // Brief delay between API calls to prevent flooding
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (err) {
        studio.changedetectionStatus = "error";
        studio.lastError = err.message;
        await studio.save();
      }
    }
  } catch (error) {
    logger.error("Error in background changedetection sync", error);
  }
}

/**
 * Bidirectional 2-Way Sync:
 * 1. If watch deleted in changedetection.io -> deletes from MongoDB & Admin Panel.
 * 2. If new watch added in changedetection.io -> creates in MongoDB & Admin Panel.
 * 3. If studio in MongoDB not yet in changedetection -> creates watch in changedetection.
 */
export const syncStudiosWithChangedetection = async (req, res) => {
  try {
    if (!changedetectionService.isConfigured()) {
      return res.status(400).json({ message: "Changedetection service not configured (missing URL or API key)" });
    }

    // 1. Fetch all live watches from changedetection.io
    const watchesRes = await changedetectionService.getWatches();
    if (!watchesRes.success) {
      return res.status(500).json({ message: "Failed to connect to changedetection.io", error: watchesRes.error });
    }

    const liveWatches = watchesRes.watches || {};
    const liveUuids = Object.keys(liveWatches);
    const liveUuidSet = new Set(liveUuids);

    // 2. BIDIRECTIONAL DELETION:
    // If a studio was registered with a UUID, but that UUID no longer exists in changedetection.io -> DELETE FROM DB
    const deleteResult = await MonitoredStudio.deleteMany({
      changedetectionUuid: { $exists: true, $ne: null, $nin: liveUuids },
      changedetectionStatus: "registered",
    });

    // 3. BIDIRECTIONAL ADDITION (from changedetection.io to MongoDB):
    let importedFromCd = 0;
    for (const uuid of liveUuids) {
      const watch = liveWatches[uuid];
      const watchUrl = watch.url || watch.link || "";
      if (!watchUrl) continue;

      // Find by UUID or Target URL
      let studio = await MonitoredStudio.findOne({
        $or: [{ changedetectionUuid: uuid }, { targetUrl: watchUrl }],
      });

      if (!studio) {
        // Newly added directly on changedetection.io dashboard!
        let hostName = "";
        try {
          hostName = new URL(watchUrl).hostname.replace(/^www\./, "");
        } catch {
          hostName = "New Studio";
        }

        await MonitoredStudio.create({
          name: watch.title || hostName,
          website: watchUrl,
          targetUrl: watchUrl,
          changedetectionUuid: uuid,
          changedetectionStatus: "registered",
          isActive: true,
          tags: watch.tags || ["studio"],
        });
        importedFromCd++;
      } else if (!studio.changedetectionUuid) {
        studio.changedetectionUuid = uuid;
        studio.changedetectionStatus = "registered";
        await studio.save();
      }
    }

    // 4. BIDIRECTIONAL PUSH (from MongoDB to changedetection.io):
    // Any active studio in DB that is not yet on changedetection
    const pendingInDb = await MonitoredStudio.find({
      $or: [
        { changedetectionUuid: { $in: [null, ""] } },
        { changedetectionStatus: { $ne: "registered" } },
      ],
      isActive: true,
    }).limit(200);

    let pushedToCd = 0;
    for (const s of pendingInDb) {
      if (!s.changedetectionUuid || !liveUuidSet.has(s.changedetectionUuid)) {
        const createRes = await changedetectionService.createWatch({
          url: s.targetUrl,
          title: s.name,
          tag: "studio",
        });

        if (createRes.success && createRes.uuid) {
          s.changedetectionUuid = createRes.uuid;
          s.changedetectionStatus = "registered";
          s.lastError = "";
          pushedToCd++;
        } else {
          s.changedetectionStatus = "error";
          s.lastError = createRes.error || "Failed to create watch";
        }
        await s.save();
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return res.status(200).json({
      success: true,
      message: `2-Way Sync Complete! Removed: ${deleteResult.deletedCount}, Added from Changedetection: ${importedFromCd}, Pushed to Changedetection: ${pushedToCd}`,
      stats: {
        removedFromDb: deleteResult.deletedCount,
        addedFromChangedetection: importedFromCd,
        pushedToChangedetection: pushedToCd,
        totalLiveOnChangedetection: liveUuids.length,
      },
    });
  } catch (err) {
    logger.error("Error in 2-way sync", err);
    return res.status(500).json({ message: "2-way sync failed", error: err.message });
  }
};

/**
 * Delete a single studio from MongoDB & changedetection.io
 */
export const deleteStudio = async (req, res) => {
  try {
    const { id } = req.params;
    const studio = await MonitoredStudio.findById(id);
    if (!studio) {
      return res.status(404).json({ message: "Studio not found" });
    }

    // Delete watch from changedetection.io
    if (studio.changedetectionUuid) {
      await changedetectionService.deleteWatch(studio.changedetectionUuid);
    }

    await MonitoredStudio.findByIdAndDelete(id);

    return res.status(200).json({ message: "Studio deleted successfully" });
  } catch (err) {
    return res.status(500).json({ message: "Failed to delete studio", error: err.message });
  }
};

/**
 * Clear all monitored studios from MongoDB & changedetection.io
 */
export const clearAllStudios = async (req, res) => {
  try {
    const allStudios = await MonitoredStudio.find({});
    for (const s of allStudios) {
      if (s.changedetectionUuid) {
        await changedetectionService.deleteWatch(s.changedetectionUuid);
      }
    }
    await MonitoredStudio.deleteMany({});
    return res.status(200).json({ message: "All monitored studios cleared successfully" });
  } catch (err) {
    return res.status(500).json({ message: "Failed to clear studios", error: err.message });
  }
};

/**
 * Get Monitored Studios list with search and pagination
 */
export const getMonitoredStudios = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "", status = "" } = req.query;

    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
        { targetUrl: { $regex: search, $options: "i" } },
      ];
    }
    if (status) {
      query.changedetectionStatus = status;
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const [studios, total] = await Promise.all([
      MonitoredStudio.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      MonitoredStudio.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: studios,
      pagination: {
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch studios", error: error.message });
  }
};

/**
 * Get Detected Jobs list for Admin Review
 */
export const getDetectedJobs = async (req, res) => {
  try {
    const { page = 1, limit = 20, status = "pending" } = req.query;

    const query = {};
    if (status && status !== "all") {
      query.status = status;
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const [detectedJobs, total] = await Promise.all([
      DetectedJob.find(query)
        .populate("studio")
        .populate("matchedCategories")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      DetectedJob.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: detectedJobs,
      pagination: {
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch detected jobs", error: error.message });
  }
};

/**
 * Convert a DetectedJob into a live active Job post
 */
export const convertDetectedJob = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      jobTitle,
      companyName,
      aboutCompany,
      website,
      instagram,
      linkedin,
      companySize,
      visualAssets,
      jobCategory,
      jobCategories = [],
      location,
      workplaceType = "On-site",
      contractType = "Full-time",
      salaryRange = "",
      overview = "",
      applicationLink = "",
      status = "active",
    } = req.body;

    const detectedJob = await DetectedJob.findById(id);
    if (!detectedJob) {
      return res.status(404).json({ message: "Detected job not found" });
    }

    if (detectedJob.status === "approved" && detectedJob.convertedJobId) {
      return res.status(400).json({ message: "Job has already been converted" });
    }

    // Create real Job document
    const newJob = await Job.create({
      companyName: companyName || detectedJob.studioName || "Studio",
      aboutCompany: aboutCompany !== undefined ? aboutCompany : (detectedJob.aboutCompany || ""),
      website: website || detectedJob.website || detectedJob.watchUrl || "",
      instagram: instagram !== undefined ? instagram : (detectedJob.instagram || ""),
      linkedin: linkedin !== undefined ? linkedin : (detectedJob.linkedin || ""),
      companySize: companySize || "",
      visualAssets: Array.isArray(visualAssets) && visualAssets.length > 0 ? visualAssets : (detectedJob.visualAssets || []),
      jobTitle: jobTitle || detectedJob.suggestedJobTitle || "Open Role",
      jobCategory: jobCategory || detectedJob.matchedCategories?.[0] || null,
      jobCategories: jobCategories.length > 0 ? jobCategories : detectedJob.matchedCategories,
      location: location || detectedJob.suggestedLocation || "",
      workplaceType,
      contractType,
      salaryRange,
      overview: overview || detectedJob.overview || detectedJob.diff || "",
      applicationLink: applicationLink || detectedJob.watchUrl || "",
      status, // 'active' by default
    });

    // Update detected job record
    detectedJob.status = "approved";
    detectedJob.convertedJobId = newJob._id;
    detectedJob.reviewedBy = req.user?._id || null;
    detectedJob.reviewedAt = new Date();
    await detectedJob.save();

    return res.status(201).json({
      success: true,
      message: "Job converted and published successfully",
      job: newJob,
    });
  } catch (error) {
    logger.error("Error converting detected job", error);
    return res.status(500).json({ message: "Failed to convert job", error: error.message });
  }
};

/**
 * Dismiss / Reject a DetectedJob
 */
export const rejectDetectedJob = async (req, res) => {
  try {
    const { id } = req.params;
    const detectedJob = await DetectedJob.findById(id);
    if (!detectedJob) {
      return res.status(404).json({ message: "Detected job not found" });
    }

    detectedJob.status = "rejected";
    detectedJob.reviewedBy = req.user?._id || null;
    detectedJob.reviewedAt = new Date();
    await detectedJob.save();

    return res.status(200).json({
      success: true,
      message: "Detected job marked as rejected",
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to reject detected job", error: error.message });
  }
};
