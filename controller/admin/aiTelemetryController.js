import { aiTelemetryService } from "../../services/aiTelemetryService.js";
import { logger } from "../../utils/logger.js";

/**
 * Get comprehensive AI telemetry: Keys status, token usage today/month/all-time,
 * quota percentage, cost estimates, breakdown by provider, and recent logs.
 * GET /api/admin/ai/telemetry
 */
export const getAiTelemetry = async (req, res) => {
  try {
    const data = await aiTelemetryService.getTelemetryStats();
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    logger.error("Failed to fetch AI telemetry", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch AI telemetry",
      error: error.message,
    });
  }
};

/**
 * Update monthly token quota or budget settings
 * PUT /api/admin/ai/settings
 */
export const updateAiSettings = async (req, res) => {
  try {
    const { monthlyTokenQuota, monthlyBudgetUsd, alertThresholdPercent } = req.body;
    const updated = await aiTelemetryService.updateSettings({
      monthlyTokenQuota,
      monthlyBudgetUsd,
      alertThresholdPercent,
    });

    return res.status(200).json({
      success: true,
      message: "AI quota settings updated successfully",
      settings: updated,
    });
  } catch (error) {
    logger.error("Failed to update AI settings", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update AI settings",
      error: error.message,
    });
  }
};
