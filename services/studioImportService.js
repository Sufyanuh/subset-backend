import xlsx from "xlsx";
import { Studio } from "../model/studio.js";
import { atsDetector } from "./atsDetector.js";
import { logger } from "../utils/logger.js";

/**
 * Studio Import Service
 * Parses CSV / Excel files or raw rows of studios and bulk-upserts them
 * into MongoDB with URL normalization, deduplication, and initial ATS detection.
 */
class StudioImportService {
  /**
   * Parse a file buffer (from Multer) or file path
   * @param {Buffer|string} input - File buffer or file path
   * @returns {Array<object>} Parsed raw objects
   */
  parseFile(input) {
    let workbook;
    if (Buffer.isBuffer(input)) {
      workbook = xlsx.read(input, { type: "buffer" });
    } else if (typeof input === "string") {
      workbook = xlsx.readFile(input);
    } else {
      throw new Error("Invalid input: Expected Buffer or file path string");
    }

    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error("Spreadsheet contains no sheets");
    }

    const worksheet = workbook.Sheets[firstSheetName];
    return xlsx.utils.sheet_to_json(worksheet, { defval: "" });
  }

  /**
   * Normalize and validate a single studio row from CSV/Excel
   * @param {object} row - Raw row from spreadsheet
   * @returns {object|null} Cleaned studio object or null if invalid
   */
  normalizeRow(row) {
    if (!row || typeof row !== "object") return null;

    // Flexible column resolution for studio name
    const name = String(
      row["Studio"] ||
        row["studio"] ||
        row["Name"] ||
        row["name"] ||
        row["Company"] ||
        row["company"] ||
        row["Studio Name"] ||
        ""
    ).trim();

    // Flexible column resolution for career URL
    let careersUrl = String(
      row["Careers URL"] ||
        row["careersUrl"] ||
        row["Career URL"] ||
        row["careerUrl"] ||
        row["Careers"] ||
        row["careers"] ||
        row["URL"] ||
        row["url"] ||
        row["Website"] ||
        row["website"] ||
        ""
    ).trim();

    // Flexible column resolution for website (root domain)
    let website = String(
      row["Website"] ||
        row["website"] ||
        row["Site"] ||
        row["site"] ||
        row["Company URL"] ||
        ""
    ).trim();

    const location = String(
      row["Location"] || row["location"] || row["City"] || row["Country"] || ""
    ).trim();

    const disciplinesRaw =
      row["Disciplines"] ||
        row["disciplines"] ||
        row["Categories"] ||
        row["categories"] ||
        row["Tags"] ||
        row["tags"] ||
        "";

    if (!name || !careersUrl) {
      return null;
    }

    // URL formatting
    careersUrl = this.formatUrl(careersUrl);
    if (!website && careersUrl) {
      try {
        const parsed = new URL(careersUrl);
        website = `${parsed.protocol}//${parsed.hostname}`;
      } catch {
        website = careersUrl;
      }
    } else if (website) {
      website = this.formatUrl(website);
    }

    // Disciplines array
    let disciplines = [];
    if (typeof disciplinesRaw === "string" && disciplinesRaw.trim()) {
      disciplines = disciplinesRaw
        .split(/[,;|]/)
        .map((d) => d.trim())
        .filter(Boolean);
    } else if (Array.isArray(disciplinesRaw)) {
      disciplines = disciplinesRaw.map((d) => String(d).trim()).filter(Boolean);
    }

    // Initial ATS detection right from URL
    const { atsType, atsIdentifier } = atsDetector.detectAts(careersUrl);

    return {
      name,
      website,
      careersUrl,
      location,
      disciplines,
      atsType,
      atsIdentifier,
      scrapingConfig: {
        status: atsType !== "custom" && atsType !== "unknown" ? "discovered" : "active",
      },
      isActive: true,
    };
  }

  /**
   * Helper: Ensure protocol exists on URL
   */
  formatUrl(url) {
    let clean = url.trim();
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      clean = `https://${clean}`;
    }
    // Remove trailing slash for uniform indexing
    return clean.replace(/\/+$/, "");
  }

  /**
   * Import studios from parsed rows or buffer into MongoDB
   * @param {Buffer|string|Array<object>} source - Input buffer, file path, or raw array
   * @param {object} [options={}] - Import options
   * @returns {Promise<object>} Import metrics and results
   */
  async importStudios(source, options = {}) {
    const { batchSize = 300 } = options;

    let rawRows;
    if (Array.isArray(source)) {
      rawRows = source;
    } else {
      rawRows = this.parseFile(source);
    }

    if (!rawRows || rawRows.length === 0) {
      return {
        success: false,
        message: "No rows found in the provided import source.",
        stats: { totalParsed: 0, upsertedCount: 0, modifiedCount: 0, skippedCount: 0 },
      };
    }

    let skippedCount = 0;
    const validStudios = [];
    const seenUrls = new Set();

    const atsSummary = {
      greenhouse: 0,
      lever: 0,
      ashby: 0,
      custom: 0,
    };

    for (const raw of rawRows) {
      const normalized = this.normalizeRow(raw);
      if (!normalized) {
        skippedCount++;
        continue;
      }

      // In-batch deduplication
      if (seenUrls.has(normalized.careersUrl)) {
        skippedCount++;
        continue;
      }
      seenUrls.add(normalized.careersUrl);

      // Track ATS stats
      if (atsSummary[normalized.atsType] !== undefined) {
        atsSummary[normalized.atsType]++;
      } else {
        atsSummary.custom++;
      }

      validStudios.push(normalized);
    }

    let upsertedCount = 0;
    let modifiedCount = 0;

    // Process in batches
    for (let i = 0; i < validStudios.length; i += batchSize) {
      const batch = validStudios.slice(i, i + batchSize);

      const bulkOps = batch.map((item) => ({
        updateOne: {
          filter: { careersUrl: item.careersUrl },
          update: {
            $set: {
              name: item.name,
              website: item.website,
              location: item.location,
              disciplines: item.disciplines,
              atsType: item.atsType,
              atsIdentifier: item.atsIdentifier,
              isActive: true,
            },
            $setOnInsert: {
              scrapingConfig: item.scrapingConfig,
            },
          },
          upsert: true,
        },
      }));

      if (bulkOps.length > 0) {
        const result = await Studio.bulkWrite(bulkOps);
        upsertedCount += result.upsertedCount || 0;
        modifiedCount += result.modifiedCount || 0;
      }
    }

    logger.info(`Bulk studio import complete. Processed ${validStudios.length} studios`, {
      totalParsed: rawRows.length,
      upsertedCount,
      modifiedCount,
      skippedCount,
      atsSummary,
    });

    return {
      success: true,
      message: `Successfully processed ${validStudios.length} studios (${upsertedCount} new, ${modifiedCount} updated).`,
      stats: {
        totalParsed: rawRows.length,
        validCount: validStudios.length,
        upsertedCount,
        modifiedCount,
        skippedCount,
        atsSummary,
      },
    };
  }
}

export const studioImportService = new StudioImportService();
export default studioImportService;
