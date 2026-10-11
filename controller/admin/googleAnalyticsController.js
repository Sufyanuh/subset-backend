import {
  fetchAnalyticsData,
  fetchRealtimeActiveUsers,
} from "../../services/googleAnalyticsService.js";

/**
 * Controller for Google Analytics 4 Dashboard Integration
 */

/**
 * GET /api/admin/dashboard/google-analytics
 * Fetch traffic overview, top pages, device breakdown, and realtime stats
 */
export const getGoogleAnalyticsStats = async (req, res) => {
  try {
    const range = req.query.range === "30d" ? "30d" : "7d";
    const data = await fetchAnalyticsData(range);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error in getGoogleAnalyticsStats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch Google Analytics statistics",
      error: error.message,
    });
  }
};

/**
 * GET /api/admin/dashboard/google-analytics/realtime
 * Fetch active users on website in the last 30 minutes
 */
export const getGoogleAnalyticsRealtime = async (req, res) => {
  try {
    const data = await fetchRealtimeActiveUsers();

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error in getGoogleAnalyticsRealtime:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch real-time active users",
      error: error.message,
    });
  }
};
