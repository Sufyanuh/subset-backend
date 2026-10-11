import express from "express";
import multer from "multer";
import {
  importStudios,
  createStudio,
  updateStudio,
  getStudios,
  getStudioById,
  scrapeSingleStudio,
  scrapeAllStudios,
  getScraperStats,
  deleteStudio,
  clearAllStudios,
  getStudioJobs,
  updateStudioFrequency,
  runStudioNow,
  resetStudio,
  getScrapingStatus,
  updateScraperSettings,
  pingCronHeartbeat,
  toggleScrapingPause,
  triggerManualBatch,
} from "../../controller/admin/studioController.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit for large studio CSVs
});

export const studioRouter = express.Router();

// 1. Bulk Ingestion
studioRouter.post("/import", upload.single("file"), importStudios);

// 2. Metrics & Global Scheduler Controls (Must be before /:id routes)
studioRouter.get("/stats", getScraperStats);
studioRouter.get("/scraping/status", getScrapingStatus);
studioRouter.put("/scraping/settings", updateScraperSettings);
studioRouter.post("/scraping/ping", pingCronHeartbeat);
studioRouter.post("/scraping/pause", toggleScrapingPause);
studioRouter.post("/scraping/resume", toggleScrapingPause);
studioRouter.post("/scraping/run-batch", triggerManualBatch);

// 3. Batch Scraping (legacy manual bulk)
studioRouter.post("/scrape-all", scrapeAllStudios);

// 4. Listing & Single Studio operations
studioRouter.get("/", getStudios);
studioRouter.post("/", createStudio);
studioRouter.delete("/", clearAllStudios);
studioRouter.get("/:id", getStudioById);
studioRouter.get("/:id/jobs", getStudioJobs);
studioRouter.put("/:id", updateStudio);
studioRouter.patch("/:id/frequency", updateStudioFrequency);
studioRouter.post("/:id/run-now", runStudioNow);
studioRouter.post("/:id/reset", resetStudio);
studioRouter.post("/:id/scrape", scrapeSingleStudio);
studioRouter.delete("/:id", deleteStudio);

export default studioRouter;
