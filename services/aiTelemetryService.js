import { AiUsage } from "../model/aiUsage.js";
import { AiSettings } from "../model/aiSettings.js";
import { logger } from "../utils/logger.js";

class AiTelemetryService {
  /**
   * Calculate approximate cost based on public pricing
   */
  calculateCost(provider, model, promptTokens = 0, completionTokens = 0) {
    const m = (model || "").toLowerCase();
    let promptRatePerMillion = 0.075;
    let completionRatePerMillion = 0.3;

    if (m.includes("gpt-4o-mini")) {
      promptRatePerMillion = 0.15;
      completionRatePerMillion = 0.6;
    } else if (m.includes("gpt-4o")) {
      promptRatePerMillion = 2.5;
      completionRatePerMillion = 10.0;
    } else if (m.includes("gemini")) {
      promptRatePerMillion = 0.075;
      completionRatePerMillion = 0.3;
    }

    const cost =
      (promptTokens / 1_000_000) * promptRatePerMillion +
      (completionTokens / 1_000_000) * completionRatePerMillion;

    return parseFloat(cost.toFixed(6));
  }

  /**
   * Mask sensitive API key for display
   */
  maskApiKey(key) {
    if (!key || typeof key !== "string" || key.length < 8) return "";
    const clean = key.trim();
    if (clean.length <= 12) return `${clean.slice(0, 3)}...${clean.slice(-3)}`;
    return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
  }

  /**
   * Log an AI call and its token usage
   */
  async recordUsage({
    provider = "gemini",
    model = "gemini-2.5-flash",
    feature = "scraper_discovery",
    studioId = null,
    studioName = "",
    promptTokens = 0,
    completionTokens = 0,
    totalTokens = 0,
    status = "success",
    errorMessage = "",
  }) {
    try {
      const finalTotal =
        totalTokens || promptTokens + completionTokens || 0;
      const cost = this.calculateCost(
        provider,
        model,
        promptTokens,
        completionTokens
      );

      const usageDoc = new AiUsage({
        provider,
        model,
        feature,
        studioId,
        studioName,
        promptTokens,
        completionTokens,
        totalTokens: finalTotal,
        estimatedCostUsd: cost,
        status,
        errorMessage,
      });

      await usageDoc.save();
      logger.info(
        `AI Usage Logged [${provider}/${model}]: ${finalTotal} tokens ($${cost}) for ${feature}`
      );
      return usageDoc;
    } catch (err) {
      logger.warn(`Failed to log AI usage: ${err.message}`);
      return null;
    }
  }

  /**
   * Get complete telemetry stats: Keys status, separate usage for Gemini & OpenAI, and recent calls
   */
  async getTelemetryStats() {
    // 1. Inspect configured keys from process.env
    const geminiRaw =
      process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    const openaiRaw = process.env.OPENAI_API_KEY || "";

    const geminiConfig = {
      provider: "Google Gemini",
      code: "gemini",
      active: Boolean(geminiRaw && geminiRaw !== "your_key_here"),
      maskedKey: this.maskApiKey(geminiRaw),
      primaryModel: "gemini-2.5-flash",
      role: "Job Scraper Selector Discovery",
      today: { tokens: 0, cost: 0, calls: 0 },
      thisMonth: { tokens: 0, cost: 0, calls: 0 },
      allTime: { tokens: 0, cost: 0, calls: 0 },
    };

    const openaiConfig = {
      provider: "OpenAI",
      code: "openai",
      active: Boolean(openaiRaw && openaiRaw !== "your_key_here"),
      maskedKey: this.maskApiKey(openaiRaw),
      primaryModel: process.env.OPENAI_VISION_MODEL || "gpt-5.6-luna",
      role: "Creative Media & Rekognition Tagging",
      today: { tokens: 0, cost: 0, calls: 0 },
      thisMonth: { tokens: 0, cost: 0, calls: 0 },
      allTime: { tokens: 0, cost: 0, calls: 0 },
    };

    // 2. Date boundaries
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // 3. Separate Aggregations by provider
    const [todayByProvider, monthByProvider, allTimeByProvider, recentLogs] =
      await Promise.all([
        // Today by provider
        AiUsage.aggregate([
          { $match: { createdAt: { $gte: startOfToday } } },
          {
            $group: {
              _id: "$provider",
              totalTokens: { $sum: "$totalTokens" },
              totalCost: { $sum: "$estimatedCostUsd" },
              calls: { $sum: 1 },
            },
          },
        ]),
        // This Month by provider
        AiUsage.aggregate([
          { $match: { createdAt: { $gte: startOfMonth } } },
          {
            $group: {
              _id: "$provider",
              totalTokens: { $sum: "$totalTokens" },
              totalCost: { $sum: "$estimatedCostUsd" },
              calls: { $sum: 1 },
            },
          },
        ]),
        // All Time by provider
        AiUsage.aggregate([
          {
            $group: {
              _id: "$provider",
              totalTokens: { $sum: "$totalTokens" },
              totalCost: { $sum: "$estimatedCostUsd" },
              calls: { $sum: 1 },
            },
          },
        ]),
        // Recent 30 calls
        AiUsage.find({})
          .sort({ createdAt: -1 })
          .limit(30)
          .lean(),
      ]);

    // Map today's stats
    for (const item of todayByProvider) {
      if (item._id === "gemini") {
        geminiConfig.today = {
          tokens: item.totalTokens || 0,
          cost: parseFloat((item.totalCost || 0).toFixed(4)),
          calls: item.calls || 0,
        };
      } else if (item._id === "openai") {
        openaiConfig.today = {
          tokens: item.totalTokens || 0,
          cost: parseFloat((item.totalCost || 0).toFixed(4)),
          calls: item.calls || 0,
        };
      }
    }

    // Map this month's stats
    for (const item of monthByProvider) {
      if (item._id === "gemini") {
        geminiConfig.thisMonth = {
          tokens: item.totalTokens || 0,
          cost: parseFloat((item.totalCost || 0).toFixed(4)),
          calls: item.calls || 0,
        };
      } else if (item._id === "openai") {
        openaiConfig.thisMonth = {
          tokens: item.totalTokens || 0,
          cost: parseFloat((item.totalCost || 0).toFixed(4)),
          calls: item.calls || 0,
        };
      }
    }

    // Map all-time stats
    for (const item of allTimeByProvider) {
      if (item._id === "gemini") {
        geminiConfig.allTime = {
          tokens: item.totalTokens || 0,
          cost: parseFloat((item.totalCost || 0).toFixed(4)),
          calls: item.calls || 0,
        };
      } else if (item._id === "openai") {
        openaiConfig.allTime = {
          tokens: item.totalTokens || 0,
          cost: parseFloat((item.totalCost || 0).toFixed(4)),
          calls: item.calls || 0,
        };
      }
    }

    return {
      providers: {
        gemini: geminiConfig,
        openai: openaiConfig,
      },
      keys: [geminiConfig, openaiConfig],
      recentLogs,
    };
  }

  /**
   * Update admin settings for quotas
   */
  async updateSettings({ monthlyTokenQuota, monthlyBudgetUsd, alertThresholdPercent }) {
    let settings = await AiSettings.findOne();
    if (!settings) {
      settings = new AiSettings({});
    }

    if (monthlyTokenQuota !== undefined) {
      settings.monthlyTokenQuota = Math.max(1000, Number(monthlyTokenQuota));
    }
    if (monthlyBudgetUsd !== undefined) {
      settings.monthlyBudgetUsd = Math.max(0, Number(monthlyBudgetUsd));
    }
    if (alertThresholdPercent !== undefined) {
      settings.alertThresholdPercent = Math.min(
        100,
        Math.max(10, Number(alertThresholdPercent))
      );
    }

    await settings.save();
    return settings;
  }
}

export const aiTelemetryService = new AiTelemetryService();
export default aiTelemetryService;
