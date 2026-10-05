import express from "express";
import {
  getDashboardStats,
  ping,
  getSpeedTestPayload,
} from "../../controller/admin/dashboardController.js";

export const dashboardRouter = express.Router();

dashboardRouter.get("/stats", getDashboardStats);
dashboardRouter.get("/ping", ping);
dashboardRouter.get("/speed-test-payload", getSpeedTestPayload);

export default dashboardRouter;
