import express from "express";
import multer from "multer";
import {
  importStudiosCsv,
  getMonitoredStudios,
  getDetectedJobs,
  convertDetectedJob,
  rejectDetectedJob,
} from "../../controller/admin/studioScraperController.js";

const upload = multer({ storage: multer.memoryStorage() });

export const studioRouter = express.Router();

// Studios Management & CSV Import
studioRouter.post("/import-csv", upload.single("file"), importStudiosCsv);
studioRouter.get("/", getMonitoredStudios);

// Detected Jobs Review Queue
export const detectedJobRouter = express.Router();
detectedJobRouter.get("/", getDetectedJobs);
detectedJobRouter.post("/:id/convert", convertDetectedJob);
detectedJobRouter.put("/:id/reject", rejectDetectedJob);
