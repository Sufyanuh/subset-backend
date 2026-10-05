import express from "express";
import { checkAuthToken } from "../../middleware/checkToken.js";
import {
  getDashboardStats,
  ping,
  getSpeedTestPayload,
} from "../../controller/admin/dashboardController.js";

export const dashboardRouter = express.Router();

dashboardRouter.get("/stats", checkAuthToken, getDashboardStats);
dashboardRouter.get("/ping", ping);
dashboardRouter.get("/speed-test-payload", getSpeedTestPayload);

export default dashboardRouter;
