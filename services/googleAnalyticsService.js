import { BetaAnalyticsDataClient } from "@google-analytics/data";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory cache for GA reports to prevent hitting Google Analytics quota limits
const cache = {
  realtime: { data: null, expiresAt: 0 },
  overview7d: { data: null, expiresAt: 0 },
  overview30d: { data: null, expiresAt: 0 },
  details: { data: null, expiresAt: 0 },
};

const CACHE_TTL_REALTIME_MS = 30 * 1000; // 30 seconds
const CACHE_TTL_HISTORICAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Helper to get an authenticated BetaAnalyticsDataClient instance
 */
function getClient() {
  const propertyId =
    process.env.GA_PROPERTY_ID || process.env.GOOGLE_ANALYTICS_PROPERTY_ID;

  if (!propertyId) {
    return { client: null, propertyId: null, reason: "GA_PROPERTY_ID is missing" };
  }

  // 1. Check for service account JSON file in config/ directory
  const keyFilePath =
    process.env.GA_KEY_FILE_PATH ||
    path.join(__dirname, "../config/ga-service-account.json");

  if (fs.existsSync(keyFilePath)) {
    try {
      const client = new BetaAnalyticsDataClient({ keyFilename: keyFilePath });
      return { client, propertyId };
    } catch (err) {
      logger.error("Failed to load GA client from key file", { error: err.message });
    }
  }

  // 2. Check for inline environment variables
  const clientEmail =
    process.env.GA_CLIENT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GA_PRIVATE_KEY;

  if (clientEmail && privateKey) {
    try {
      // Handle escaped newlines in .env
      privateKey = privateKey.replace(/\\n/g, "\n");
      const client = new BetaAnalyticsDataClient({
        credentials: {
          client_email: clientEmail,
          private_key: privateKey,
        },
      });
      return { client, propertyId };
    } catch (err) {
      logger.error("Failed to load GA client from env credentials", {
        error: err.message,
      });
    }
  }

  return {
    client: null,
    propertyId,
    reason: "No service account JSON key file or GA_CLIENT_EMAIL/GA_PRIVATE_KEY found",
  };
}

/**
 * Fetch real-time active users currently browsing the website
 */
export async function fetchRealtimeActiveUsers() {
  const now = Date.now();
  if (cache.realtime.data && cache.realtime.expiresAt > now) {
    return cache.realtime.data;
  }

  const { client, propertyId, reason } = getClient();
  if (!client) {
    return {
      configured: false,
      activeUsers: 0,
      reason,
    };
  }

  try {
    const [response] = await client.runRealtimeReport({
      property: `properties/${propertyId}`,
      metrics: [{ name: "activeUsers" }],
    });

    const activeUsers =
      Number(response?.rows?.[0]?.metricValues?.[0]?.value) || 0;

    const result = {
      configured: true,
      activeUsers,
      timestamp: new Date().toISOString(),
    };

    cache.realtime = {
      data: result,
      expiresAt: now + CACHE_TTL_REALTIME_MS,
    };

    return result;
  } catch (err) {
    logger.error("Error fetching GA Realtime report", { error: err.message });
    return {
      configured: false,
      activeUsers: 0,
      error: err.message,
    };
  }
}

/**
 * Fetch comprehensive GA4 analytics (overview trend, top pages, devices, countries)
 * @param {string} range '7d' or '30d'
 */
export async function fetchAnalyticsData(range = "7d") {
  const cacheKey = range === "30d" ? "overview30d" : "overview7d";
  const now = Date.now();

  if (cache[cacheKey].data && cache[cacheKey].expiresAt > now) {
    return cache[cacheKey].data;
  }

  const { client, propertyId, reason } = getClient();
  if (!client) {
    return {
      configured: false,
      reason,
      propertyId: propertyId || null,
      measurementId: "G-6XXSJWRVVC",
      // Sample preview mock data so dashboard UI does not crash or look empty
      isMock: true,
      realtimeUsers: 0,
      totals: {
        activeUsers: 0,
        pageviews: 0,
        sessions: 0,
        averageEngagementTimeSec: 0,
      },
      chartData: [],
      topPages: [],
      deviceBreakdown: [
        { label: "Desktop", percentage: 0 },
        { label: "Mobile", percentage: 0 },
        { label: "Tablet", percentage: 0 },
      ],
      topCountries: [],
    };
  }

  try {
    const startDate = range === "30d" ? "30daysAgo" : "7daysAgo";

    // Run parallel reports: Traffic timeline, Top Pages, Devices, Countries, Realtime
    const [
      trafficReportResponse,
      topPagesResponse,
      deviceResponse,
      countryResponse,
      realtimeReportResponse,
    ] = await Promise.all([
      // 1. Daily trend
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate, endDate: "today" }],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "activeUsers" },
          { name: "screenPageViews" },
          { name: "sessions" },
        ],
        orderBys: [
          { dimension: { orderType: "ALPHANUMERIC", dimensionName: "date" } },
        ],
      }),
      // 2. Top pages
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate, endDate: "today" }],
        dimensions: [{ name: "pageTitle" }, { name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
        limit: 8,
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      }),
      // 3. Device breakdown
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate, endDate: "today" }],
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "activeUsers" }],
      }),
      // 4. Top Countries
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate, endDate: "today" }],
        dimensions: [{ name: "country" }],
        metrics: [{ name: "activeUsers" }],
        limit: 5,
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      }),
      // 5. Realtime
      client
        .runRealtimeReport({
          property: `properties/${propertyId}`,
          metrics: [{ name: "activeUsers" }],
        })
        .catch(() => [{ rows: [] }]),
    ]);

    // Format Timeline Chart
    const trafficRows = trafficReportResponse[0]?.rows || [];
    let totalUsers = 0;
    let totalViews = 0;
    let totalSessions = 0;

    const chartData = trafficRows.map((row) => {
      const rawDate = row.dimensionValues?.[0]?.value || "";
      // YYYYMMDD to YYYY-MM-DD
      const formattedDate =
        rawDate.length === 8
          ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
          : rawDate;

      const activeUsers = Number(row.metricValues?.[0]?.value) || 0;
      const pageviews = Number(row.metricValues?.[1]?.value) || 0;
      const sessions = Number(row.metricValues?.[2]?.value) || 0;

      totalUsers += activeUsers;
      totalViews += pageviews;
      totalSessions += sessions;

      return {
        date: formattedDate,
        activeUsers,
        pageviews,
        sessions,
      };
    });

    // Format Top Pages
    const topPages = (topPagesResponse[0]?.rows || []).map((row) => ({
      title: row.dimensionValues?.[0]?.value || "Untitled",
      path: row.dimensionValues?.[1]?.value || "/",
      pageviews: Number(row.metricValues?.[0]?.value) || 0,
      activeUsers: Number(row.metricValues?.[1]?.value) || 0,
    }));

    // Format Devices
    const deviceRows = deviceResponse[0]?.rows || [];
    let deviceTotalUsers = 0;
    const deviceCounts = deviceRows.map((row) => {
      const category = row.dimensionValues?.[0]?.value || "Unknown";
      const users = Number(row.metricValues?.[0]?.value) || 0;
      deviceTotalUsers += users;
      return { label: category, count: users };
    });

    const deviceBreakdown = deviceCounts.map((d) => ({
      label: d.label.charAt(0).toUpperCase() + d.label.slice(1),
      count: d.count,
      percentage:
        deviceTotalUsers > 0
          ? Math.round((d.count / deviceTotalUsers) * 100)
          : 0,
    }));

    // Format Countries
    const topCountries = (countryResponse[0]?.rows || []).map((row) => ({
      country: row.dimensionValues?.[0]?.value || "Unknown",
      activeUsers: Number(row.metricValues?.[0]?.value) || 0,
    }));

    // Realtime Users
    const realtimeUsers =
      Number(realtimeReportResponse[0]?.rows?.[0]?.metricValues?.[0]?.value) || 0;

    const result = {
      configured: true,
      measurementId: "G-6XXSJWRVVC",
      propertyId,
      range,
      realtimeUsers,
      totals: {
        activeUsers: totalUsers,
        pageviews: totalViews,
        sessions: totalSessions,
      },
      chartData,
      topPages,
      deviceBreakdown,
      topCountries,
      lastUpdated: new Date().toISOString(),
    };

    cache[cacheKey] = {
      data: result,
      expiresAt: now + CACHE_TTL_HISTORICAL_MS,
    };

    return result;
  } catch (err) {
    logger.error("Error fetching Google Analytics data", { error: err.message });
    return {
      configured: false,
      error: err.message,
      propertyId,
      measurementId: "G-6XXSJWRVVC",
      isMock: true,
      realtimeUsers: 0,
      totals: {
        activeUsers: 0,
        pageviews: 0,
        sessions: 0,
        averageEngagementTimeSec: 0,
      },
      chartData: [],
      topPages: [],
      deviceBreakdown: [],
      topCountries: [],
    };
  }
}

