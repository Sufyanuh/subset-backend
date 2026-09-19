import axios from "axios";
import { logger } from "../utils/logger.js";

class ChangedetectionService {
  constructor() {
    this.apiUrl = process.env.CHANGEDETECTION_API_URL || "http://localhost:5000";
    this.apiKey = process.env.CHANGEDETECTION_API_KEY || "";
    this.webhookUrl = process.env.BACKEND_WEBHOOK_URL || "";
  }

  getClient() {
    return axios.create({
      baseURL: this.apiUrl.replace(/\/+$/, ""),
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
      },
      timeout: 10000,
    });
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiUrl);
  }

  /**
   * Create a watch on changedetection.io
   */
  async createWatch({ url, title, tag = "studio", triggerWords = [] }) {
    if (!this.isConfigured()) {
      logger.warn("Changedetection API not configured (missing URL or API key)");
      return { success: false, error: "Changedetection not configured" };
    }

    try {
      const client = this.getClient();
      const payload = {
        url,
        title: title || url,
        tag: tag || "studio",
        time_between_check: {
          hours: 12, // Check twice daily to avoid rate-limits
        },
      };

      // If trigger words provided (e.g. from job categories)
      if (triggerWords && triggerWords.length > 0) {
        payload.trigger_text = triggerWords;
      }

      const response = await client.post("/api/v1/watch", payload);
      const uuid = response.data?.uuid || response.data?.watch_id || response.data;

      return {
        success: true,
        uuid: typeof uuid === "string" ? uuid : String(uuid?.uuid || ""),
        data: response.data,
      };
    } catch (error) {
      logger.error("Error creating watch in changedetection.io", {
        url,
        title,
        message: error.response?.data || error.message,
      });
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }

  /**
   * Delete watch from changedetection.io
   */
  async deleteWatch(uuid) {
    if (!this.isConfigured() || !uuid) {
      return { success: false, error: "Not configured or missing UUID" };
    }

    try {
      const client = this.getClient();
      await client.delete(`/api/v1/watch/${uuid}`);
      return { success: true };
    } catch (error) {
      logger.error("Error deleting watch from changedetection.io", {
        uuid,
        message: error.response?.data || error.message,
      });
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }

  /**
   * Get all watches from changedetection.io
   */
  async getWatches() {
    if (!this.isConfigured()) {
      return { success: false, watches: [] };
    }

    try {
      const client = this.getClient();
      const response = await client.get("/api/v1/watch");
      return { success: true, watches: response.data };
    } catch (error) {
      logger.error("Error fetching watches from changedetection.io", {
        message: error.response?.data || error.message,
      });
      return { success: false, error: error.message, watches: [] };
    }
  }

  /**
   * Trigger immediate recheck of a watch
   */
  async recheckWatch(uuid) {
    if (!this.isConfigured() || !uuid) {
      return { success: false, error: "Not configured or missing UUID" };
    }

    try {
      const client = this.getClient();
      await client.get(`/api/v1/watch/${uuid}/check`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

export const changedetectionService = new ChangedetectionService();
