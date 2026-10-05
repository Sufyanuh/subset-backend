import { User } from "../../model/user.js";
import { Job } from "../../model/job.js";
import { Studio } from "../../model/studio.js";
import { Discover } from "../../model/discover.js";
import { Categories } from "../../model/categories.js";
import { JobCategory } from "../../model/jobCategory.js";
import { Mentor } from "../../model/mentor.js";
import { Spotlight } from "../../model/spotlight.js";
import { logger } from "../../utils/logger.js";
import os from "os";

/**
 * Controller for Admin Executive Dashboard
 */

/**
 * Get comprehensive platform statistics for Admin Dashboard
 * GET /api/admin/dashboard/stats
 */
export const getDashboardStats = async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Parallel aggregate count queries
    const [
      totalUsers,
      activeSubscribers,
      newUsersThisWeek,
      totalJobs,
      activeJobs,
      pendingJobs,
      totalStudios,
      totalDiscoveries,
      totalCategories,
      totalJobCategories,
      totalMentors,
      totalSpotlights,
      workplaceAggregation,
      jobStatusAggregation,
      recentJobs,
      recentUsers,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ subscriptionStatus: { $in: ["active", "trialing"] } }),
      User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Job.countDocuments({}),
      Job.countDocuments({ status: "active" }),
      Job.countDocuments({ status: "pending" }),
      Studio.countDocuments({}),
      Discover.countDocuments({}),
      Categories.countDocuments({}),
      JobCategory.countDocuments({}),
      Mentor.countDocuments({}),
      Spotlight.countDocuments({}),
      // Workplace breakdown (Remote, Hybrid, On-site)
      Job.aggregate([
        { $group: { _id: "$workplaceType", count: { $sum: 1 } } },
      ]),
      // Job status breakdown (active, pending, expired, draft)
      Job.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      // Latest 6 jobs
      Job.find({})
        .sort({ createdAt: -1 })
        .limit(6)
        .select("_id jobTitle companyName location workplaceType contractType status createdAt")
        .lean(),
      // Latest 5 users
      User.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .select("_id fullName username email role subscriptionStatus createdAt")
        .lean(),
    ]);

    // Format workplace distribution
    const workplaceBreakdown = {
      Remote: 0,
      Hybrid: 0,
      "On-site": 0,
    };
    for (const item of workplaceAggregation) {
      if (item._id && workplaceBreakdown[item._id] !== undefined) {
        workplaceBreakdown[item._id] = item.count;
      } else if (item._id) {
        workplaceBreakdown[item._id] = item.count;
      }
    }

    // Format job status breakdown
    const statusBreakdown = {
      active: activeJobs,
      pending: pendingJobs,
    };
    for (const item of jobStatusAggregation) {
      if (item._id) {
        statusBreakdown[item._id] = item.count;
      }
    }

    // Server health telemetry
    const memoryUsage = process.memoryUsage();
    const serverHealth = {
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memoryUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      memoryTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      systemFreeMemMB: Math.round(os.freemem() / 1024 / 1024),
      systemTotalMemMB: Math.round(os.totalmem() / 1024 / 1024),
      timestamp: Date.now(),
    };

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        activeSubscribers,
        newUsersThisWeek,
        totalJobs,
        activeJobs,
        pendingJobs,
        totalStudios,
        totalDiscoveries,
        totalCategories,
        totalJobCategories,
        totalMentors,
        totalSpotlights,
        workplaceBreakdown,
        statusBreakdown,
        recentJobs,
        recentUsers,
        server: serverHealth,
      },
    });
  } catch (error) {
    logger.error("Error retrieving dashboard stats", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve dashboard stats",
      error: error.message,
    });
  }
};

/**
 * Lightweight Ping endpoint for latency measurement
 * GET /api/admin/dashboard/ping
 */
export const ping = (req, res) => {
  return res.status(200).json({
    success: true,
    serverTime: Date.now(),
    message: "pong",
  });
};

/**
 * Speed test payload endpoint (500KB test buffer)
 * GET /api/admin/dashboard/speed-test-payload
 */
export const getSpeedTestPayload = (req, res) => {
  // Generate 500KB buffer of random printable characters
  const size = 500 * 1024;
  const chunk = Buffer.alloc(size, "A");
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", size);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  return res.status(200).send(chunk);
};
