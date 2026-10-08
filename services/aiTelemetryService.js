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
   * Get complete telemetry stats, keys status, quota and recent calls
   */
  async getTelemetryStats() {
    // 1. Inspect configured keys from process.env
    const geminiRaw =
      process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    const openaiRaw = process.env.OPENAI_API_KEY || "";

    const keysConfig = [
      {
        provider: "Google Gemini",
        code: "gemini",
        active: Boolean(geminiRaw && geminiRaw !== "your_key_here"),
        maskedKey: this.maskApiKey(geminiRaw),
        primaryModel: "gemini-2.5-flash",
        description: "Primary fast model for Selector Discovery & SPA extraction",
      },
      {
        provider: "OpenAI",
        code: "openai",
        active: Boolean(openaiRaw && openaiRaw !== "your_key_here"),
        maskedKey: this.maskApiKey(openaiRaw),
        primaryModel: "gpt-4o-mini",
        description: "Automatic fallback model & AWS image analysis",
      },
    ];

    // 2. Fetch or initialize settings
    let settings = await AiSettings.findOne();
    if (!settings) {
      settings = await AiSettings.create({
        monthlyTokenQuota: 1000000,
        monthlyBudgetUsd: 10.0,
        alertThresholdPercent: 80,
      });
    }

    // 3. Date boundaries
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // 4. Aggregations
    const [
      todayAgg,
      monthAgg,
      allTimeAgg,
      providerAgg,
      recentLogs,
    ] = await Promise.all([
      // Today
      AiUsage.aggregate([
        { $match: { createdAt: { $gte: startOfToday } } },
        {
          $group: {
            _id: null,
            totalTokens: { $sum: "$totalTokens" },
            totalCost: { $sum: "$estimatedCostUsd" },
            calls: { $sum: 1 },
          },
        },
      ]),
      // This Month
      AiUsage.aggregate([
        { $match: { createdAt: { $gte: startOfMonth } } },
        {
          $group: {
            _id: null,
            totalTokens: { $sum: "$totalTokens" },
            promptTokens: { $sum: "$promptTokens" },
            completionTokens: { $sum: "$completionTokens" },
            totalCost: { $sum: "$estimatedCostUsd" },
            calls: { $sum: 1 },
          },
        },
      ]),
      // All Time
      AiUsage.aggregate([
        {
          $group: {
            _id: null,
            totalTokens: { $sum: "$totalTokens" },
            totalCost: { $sum: "$estimatedCostUsd" },
            calls: { $sum: 1 },
          },
        },
      ]),
      // By Provider (This Month)
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
      // Recent 20 calls
      AiUsage.find({})
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    const tokensToday = todayAgg[0]?.totalTokens || 0;
    const costToday = parseFloat((todayAgg[0]?.totalCost || 0).toFixed(4));
    const callsToday = todayAgg[0]?.calls || 0;

    const tokensThisMonth = monthAgg[0]?.totalTokens || 0;
    const promptTokensThisMonth = monthAgg[0]?.promptTokens || 0;
    const completionTokensThisMonth = monthAgg[0]?.completionTokens || 0;
    const costThisMonth = parseFloat((monthAgg[0]?.totalCost || 0).toFixed(4));
    const callsThisMonth = monthAgg[0]?.calls || 0;

    const tokensAllTime = allTimeAgg[0]?.totalTokens || 0;
    const costAllTime = parseFloat((allTimeAgg[0]?.totalCost || 0).toFixed(4));
    const callsAllTime = allTimeAgg[0]?.calls || 0;

    // Quota calculations
    const quota = settings.monthlyTokenQuota || 1000000;
    const remainingTokens = Math.max(0, quota - tokensThisMonth);
    const percentageUsed = Math.min(
      100,
      parseFloat(((tokensThisMonth / quota) * 100).toFixed(1))
    );

    const budget = settings.monthlyBudgetUsd || 10.0;
    const remainingBudgetUsd = Math.max(
      0,
      parseFloat((budget - costThisMonth).toFixed(4))
    );

    // Breakdown map
    const breakdown = {
      gemini: { tokens: 0, cost: 0, calls: 0 },
      openai: { tokens: 0, cost: 0, calls: 0 },
    };
    for (const item of providerAgg) {
      if (item._id && breakdown[item._id]) {
        breakdown[item._id] = {
          tokens: item.totalTokens,
          cost: parseFloat((item.totalCost || 0).toFixed(4)),
          calls: item.calls,
        };
      }
    }

    return {
      keys: keysConfig,
      quota: {
        monthlyTokenQuota: quota,
        monthlyBudgetUsd: budget,
        tokensUsedThisMonth: tokensThisMonth,
        promptTokensThisMonth,
        completionTokensThisMonth,
        remainingTokens,
        percentageUsed,
        costThisMonth,
        remainingBudgetUsd,
        alertThresholdPercent: settings.alertThresholdPercent || 80,
      },
      summary: {
        today: { tokens: tokensToday, cost: costToday, calls: callsToday },
        thisMonth: {
          tokens: tokensThisMonth,
          cost: costThisMonth,
          calls: callsThisMonth,
        },
        allTime: {
          tokens: tokensAllTime,
          cost: costAllTime,
          calls: callsAllTime,
        },
      },
      breakdown,
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
