import express from "express";
import {
  getAiTelemetry,
  updateAiSettings,
} from "../../controller/admin/aiTelemetryController.js";

export const aiRouter = express.Router();

aiRouter.get("/telemetry", getAiTelemetry);
aiRouter.put("/settings", updateAiSettings);

export default aiRouter;
