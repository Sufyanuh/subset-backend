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
} from "../../controller/admin/studioController.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit for large studio CSVs
});

export const studioRouter = express.Router();

// 1. Bulk Ingestion
studioRouter.post("/import", upload.single("file"), importStudios);

// 2. Metrics & Stats
studioRouter.get("/stats", getScraperStats);

// 3. Batch Scraping
studioRouter.post("/scrape-all", scrapeAllStudios);

// 4. Listing & Single Studio operations
studioRouter.get("/", getStudios);
studioRouter.post("/", createStudio);
studioRouter.delete("/", clearAllStudios);
studioRouter.get("/:id", getStudioById);
studioRouter.get("/:id/jobs", getStudioJobs);
studioRouter.put("/:id", updateStudio);
studioRouter.post("/:id/scrape", scrapeSingleStudio);
studioRouter.delete("/:id", deleteStudio);

export default studioRouter;
