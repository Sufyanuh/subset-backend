import express from "express";
import { checkAuthToken } from "../../middleware/checkToken.js";
import {
  getDashboardStats,
  ping,
  getSpeedTestPayload,
} from "../../controller/admin/dashboardController.js";
import {
  getGoogleAnalyticsStats,
  getGoogleAnalyticsRealtime,
} from "../../controller/admin/googleAnalyticsController.js";

export const dashboardRouter = express.Router();

dashboardRouter.get("/stats", checkAuthToken, getDashboardStats);
dashboardRouter.get("/ping", ping);
dashboardRouter.get("/speed-test-payload", getSpeedTestPayload);

// Google Analytics 4 Endpoints
dashboardRouter.get("/google-analytics", checkAuthToken, getGoogleAnalyticsStats);
dashboardRouter.get("/google-analytics/realtime", checkAuthToken, getGoogleAnalyticsRealtime);

export default dashboardRouter;

