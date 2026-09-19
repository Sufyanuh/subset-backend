import { MonitoredStudio } from "../../model/monitoredStudio.js";
import { DetectedJob } from "../../model/detectedJob.js";
import { JobCategory } from "../../model/jobCategory.js";
import { jobMetadataEnricher } from "../../services/jobMetadataEnricher.js";
import { logger } from "../../utils/logger.js";

/**
 * Handle incoming webhook notifications from changedetection.io
 */
export const handleChangedetectionWebhook = async (req, res) => {
  try {
    const payload = req.body || {};

    const watchUrl =
      payload.watch_url || payload.url || payload.target_url || "";
    const watchUuid = payload.watch_uuid || payload.uuid || "";
    const diff = payload.diff || payload.diff_full || "";
    const snapshotUrl =
      payload.current_snapshot || payload.snapshot || payload.screenshot || "";
    const studioTitle =
      payload.watch_title || payload.title || payload.studio || "";

    if (!watchUrl && !watchUuid) {
      logger.warn("Changedetection webhook missing watch_url and watch_uuid", {
        payload,
      });
      return res
        .status(400)
        .json({ success: false, message: "Missing watch_url or watch_uuid" });
    }

    // 1. Find matching MonitoredStudio
    let studio = null;
    if (watchUuid) {
      studio = await MonitoredStudio.findOne({ changedetectionUuid: watchUuid });
    }
    if (!studio && watchUrl) {
      studio = await MonitoredStudio.findOne({
        $or: [{ targetUrl: watchUrl }, { website: watchUrl }],
      });
    }

    // 2. Fetch categories for smart matching
    const allCategories = await JobCategory.find({}).select("name");
    const matchedCategories = [];
    const matchedCategoryNames = [];

    const textToAnalyze = `${diff} ${studioTitle}`.toLowerCase();

    for (const cat of allCategories) {
      if (!cat.name) continue;
      const catKeyword = cat.name.toLowerCase();
      // Match whole words or phrase
      if (textToAnalyze.includes(catKeyword)) {
        matchedCategories.push(cat._id);
        matchedCategoryNames.push(cat.name);
      }
    }

    // Fallback: If studio has disciplines, see if any match categories
    if (studio && studio.disciplines && studio.disciplines.length > 0) {
      for (const disc of studio.disciplines) {
        const discLower = disc.toLowerCase();
        for (const cat of allCategories) {
          if (
            cat.name &&
            (cat.name.toLowerCase().includes(discLower) ||
              discLower.includes(cat.name.toLowerCase()))
          ) {
            if (!matchedCategories.some((id) => id.equals(cat._id))) {
              matchedCategories.push(cat._id);
              matchedCategoryNames.push(cat.name);
            }
          }
        }
      }
    }

    // 3. Enrich with Studio metadata (Logo, About, Socials) & parse Role fields
    const targetSiteUrl = studio?.website || watchUrl;
    const studioMeta = await jobMetadataEnricher.scrapeStudioMetadata(targetSiteUrl);
    const roleDetails = await jobMetadataEnricher.extractJobDetails({
      diff,
      diffFull: payload.diff_full || diff,
      studioName: studio?.name || studioTitle,
      url: watchUrl,
      existingMetadata: studioMeta,
    });

    // 4. Create DetectedJob entry with full details
    const detectedJob = await DetectedJob.create({
      studio: studio ? studio._id : null,
      studioName: studio?.name || studioTitle || "Unknown Studio",
      watchUrl: watchUrl || studio?.targetUrl || "",
      watchUuid,
      diff,
      diffFull: payload.diff_full || diff,
      snapshotUrl,
      matchedCategories,
      matchedCategoryNames,
      suggestedJobTitle: roleDetails.jobTitle || "Open Role",
      suggestedLocation: studio?.location || "",
      aboutCompany: studioMeta.aboutCompany || "",
      website: targetSiteUrl,
      instagram: studioMeta.instagram || "",
      linkedin: studioMeta.linkedin || "",
      visualAssets: studioMeta.visualAssets || [],
      workplaceType: roleDetails.workplaceType || "On-site",
      contractType: roleDetails.contractType || "Full-time",
      salaryRange: roleDetails.salaryRange || "",
      overview: roleDetails.overview || diff,
      status: "pending",
      rawPayload: payload,
    });

    // 5. Update Studio's last detected date
    if (studio) {
      studio.lastChangeDetectedAt = new Date();
      await studio.save();
    }

    logger.info(`Detected new job change for studio: ${detectedJob.studioName}`, {
      detectedJobId: detectedJob._id,
      url: watchUrl,
    });

    return res.status(200).json({
      success: true,
      message: "Detected job recorded successfully",
      data: detectedJob,
    });
  } catch (error) {
    logger.error("Error processing changedetection webhook", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error processing webhook",
      error: error.message,
    });
  }
};
