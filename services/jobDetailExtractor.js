import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "../utils/logger.js";

/**
 * Job Detail Extractor Service
 * Extracts rich, structured job details (title, description, salary, location,
 * workplace type, contract type, logo, and posting date) from individual job URLs.
 *
 * Strategies:
 * 1. Schema.org JSON-LD (application/ld+json with @type: "JobPosting") - 100% structured, 0 AI tokens.
 * 2. Semantic HTML & OpenGraph fallback - for custom/non-standard sites.
 */
export class JobDetailExtractor {
  constructor() {
    this.http = axios.create({
      timeout: 30000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  }

  /**
   * Main extraction entry point
   * @param {string} url - Individual job posting URL
   * @returns {Promise<object>} Standardized job details
   */
  async extractFromUrl(url) {
    if (!url || typeof url !== "string") {
      throw new Error("Valid Job URL is required");
    }

    const cleanUrl = url.trim();

    try {
      const response = await this.http.get(cleanUrl);
      const html = typeof response.data === "string" ? response.data : "";
      if (!html) {
        throw new Error("No HTML content returned from URL");
      }

      const $ = cheerio.load(html);

      // 1. Try JSON-LD first
      const jsonLdResult = this.extractFromJsonLd($, cleanUrl);
      if (jsonLdResult && jsonLdResult.jobTitle) {
        return jsonLdResult;
      }

      // 2. Fallback to OpenGraph and semantic HTML
      const htmlResult = this.extractFromHtml($, cleanUrl);
      return htmlResult;
    } catch (err) {
      logger.warn(`[JobDetailExtractor] Failed to extract from URL: ${cleanUrl} (${err.message})`);
      throw err;
    }
  }

  /**
   * Strategy 1: Extract from Schema.org JSON-LD (JobPosting)
   */
  extractFromJsonLd($, url) {
    let jobPosting = null;

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = $(el).html();
        if (!raw) return;
        const parsed = JSON.parse(raw);

        const checkObj = (obj) => {
          if (!obj || typeof obj !== "object") return;
          const type = obj["@type"];
          if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) {
            jobPosting = obj;
          }
          if (Array.isArray(obj["@graph"])) {
            obj["@graph"].forEach(checkObj);
          }
        };

        if (Array.isArray(parsed)) {
          parsed.forEach(checkObj);
        } else {
          checkObj(parsed);
        }
      } catch {
        // Ignore JSON parse errors in non-standard scripts
      }
    });

    if (!jobPosting) return null;

    const jobTitle = String(jobPosting.title || "").trim();
    let overview = String(jobPosting.description || "").trim();

    // Clean Overview HTML
    overview = this.cleanHtmlForEditor(overview);

    // Salary extraction
    const salaryRange = this.extractSalary(jobPosting, overview, $.root().text());

    // Location extraction
    const location = this.extractLocation(jobPosting);

    // Workplace Type
    const workplaceType = this.extractWorkplaceType(jobPosting, overview, location);

    // Contract Type
    const contractType = this.extractContractType(jobPosting.employmentType, overview);

    // Company & Logo
    const companyName =
      jobPosting.hiringOrganization?.name ||
      $('meta[property="og:site_name"]').attr("content") ||
      "";
    const logo =
      typeof jobPosting.hiringOrganization?.logo === "string"
        ? jobPosting.hiringOrganization.logo
        : jobPosting.hiringOrganization?.logo?.url || "";

    // Date Posted
    const postedAt = jobPosting.datePosted ? new Date(jobPosting.datePosted) : null;

    return {
      success: true,
      jobTitle,
      companyName,
      overview,
      salaryRange,
      location,
      workplaceType,
      contractType,
      logo,
      applicationLink: this.cleanTrackingParams(jobPosting.url || url),
      postedAt: postedAt && !isNaN(postedAt.getTime()) ? postedAt : null,
      source: "json_ld",
    };
  }

  /**
   * Strategy 2: Extract from HTML elements and meta tags
   */
  extractFromHtml($, url) {
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("h1").first().text().trim() ||
      $("title").text().split(/[-|–]/)[0].trim();

    const companyName =
      $('meta[property="og:site_name"]').attr("content") ||
      "";

    const logo =
      $('meta[property="og:image"]').attr("content") ||
      $('link[rel="apple-touch-icon"]').attr("href") ||
      "";

    // Extract body text or article
    let overview = "";
    const contentContainer = $("article, main, .job-description, .description, .content, #job-content").first();
    if (contentContainer.length > 0) {
      overview = contentContainer.html() || "";
    } else {
      overview = $("body").html() || "";
    }

    overview = this.cleanHtmlForEditor(overview);
    const salaryRange = this.extractSalary({}, overview, $.root().text());

    // Location search
    let location = "";
    $('[class*="location"], [data-qa="location"], [class*="city"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length < 50 && !location) {
        location = text;
      }
    });

    const combinedText = `${title} ${overview} ${location}`.toLowerCase();
    const workplaceType = combinedText.includes("remote") && !combinedText.includes("non-remote")
      ? "Remote"
      : combinedText.includes("hybrid")
      ? "Hybrid"
      : "On-site";

    const contractType = this.extractContractType("", overview);

    return {
      success: true,
      jobTitle: title,
      companyName,
      overview,
      salaryRange,
      location,
      workplaceType,
      contractType,
      logo,
      applicationLink: this.cleanTrackingParams(url),
      postedAt: null,
      source: "html_fallback",
    };
  }

  /**
   * Smart salary parser from Schema.org and text regex
   */
  extractSalary(jobPosting, overviewText, bodyText) {
    // 1. Check Schema.org baseSalary
    if (jobPosting.baseSalary) {
      const bs = jobPosting.baseSalary;
      const currency = bs.currency || "$";
      const val = bs.value;
      if (val) {
        if (typeof val === "number" || typeof val === "string") {
          return `${currency}${val}`;
        }
        if (val.minValue && val.maxValue) {
          const unit = val.unitText ? `/${val.unitText.toLowerCase()}` : "";
          return `${currency}${val.minValue} – ${currency}${val.maxValue}${unit}`;
        }
        if (val.value) {
          const unit = val.unitText ? `/${val.unitText.toLowerCase()}` : "";
          return `${currency}${val.value}${unit}`;
        }
      }
    }

    // 2. Scan text for compensation / salary patterns
    const fullText = `${overviewText} ${bodyText}`;

    // Pattern 1: Explicit labels: "Compensation: $22.60/hr", "Salary: $120k - $140k"
    const compMatch = fullText.match(
      /(?:compensation|salary|pay|rate|hourly|annual|base pay)[:\s]*([$€£¥]\s*\d[\d,.]*\s*(?:k|K)?(?:\s*(?:–|-|to)\s*[$€£¥]?\s*\d[\d,.]*\s*(?:k|K)?)?(?:\s*\/\s*(?:hr|hour|yr|year|annum|month))?)/i
    );
    if (compMatch && compMatch[1]) {
      return compMatch[1].trim();
    }

    // Pattern 2: Standalone rates with /hr or /yr: "$22.60/hr"
    const rateMatch = fullText.match(
      /([$€£¥]\s*\d[\d,.]+\s*(?:\/|\s*per\s*)(?:hr|hour|yr|year|annum|month))/i
    );
    if (rateMatch && rateMatch[1]) {
      return rateMatch[1].trim();
    }

    // Pattern 3: Ranges like "$120,000 – $140,000" or "$80k – $100k"
    const rangeMatch = fullText.match(
      /([$€£¥]\s*\d{2,3}(?:,\d{3})|\d{2,3}k)\s*(?:–|-|to)\s*([$€£¥]?\s*\d{2,3}(?:,\d{3})|\d{2,3}k)/i
    );
    if (rangeMatch) {
      return `${rangeMatch[1]} – ${rangeMatch[2]}`.trim();
    }

    return "";
  }

  /**
   * Extract and normalize location from JSON-LD
   */
  extractLocation(jobPosting) {
    if (!jobPosting.jobLocation) return "";
    const loc = jobPosting.jobLocation;
    const addr = loc.address;
    if (typeof addr === "string") return addr.trim();
    if (addr && typeof addr === "object") {
      let country = addr.addressCountry || "";
      if (country === "US" || country === "USA") country = "United States";
      else if (country === "UK" || country === "GB") country = "United Kingdom";

      const parts = [addr.addressLocality, addr.addressRegion, country].filter(Boolean);
      return parts.join(", ");
    }
    return loc.name || "";
  }

  /**
   * Extract workplace type (On-site, Hybrid, Remote)
   */
  extractWorkplaceType(jobPosting, overview, location) {
    if (jobPosting.jobLocationType === "TELECOMMUTE") {
      return "Remote";
    }
    const combined = `${jobPosting.title || ""} ${overview || ""} ${location || ""}`.toLowerCase();
    if (combined.includes("remote") && !combined.includes("non-remote")) return "Remote";
    if (combined.includes("hybrid")) return "Hybrid";
    return "On-site";
  }

  /**
   * Extract contract type (Full-time, Part-time, Contract, Freelance, Internship)
   */
  extractContractType(employmentType, overview) {
    const et = String(employmentType || "").toUpperCase();
    if (et.includes("INTERN")) return "Internship";
    if (et.includes("PART_TIME") || et.includes("PARTTIME")) return "Part-time";
    if (et.includes("CONTRACT") || et.includes("TEMP")) return "Contract";
    if (et.includes("FREELANCE")) return "Freelance";
    if (et.includes("FULL_TIME") || et.includes("FULLTIME")) return "Full-time";

    const text = (overview || "").toLowerCase();
    if (text.includes("internship") || text.includes("apprentice")) return "Internship";
    if (text.includes("part-time") || text.includes("part time")) return "Part-time";
    if (text.includes("freelance")) return "Freelance";
    if (text.includes("contract")) return "Contract";
    return "Full-time";
  }

  /**
   * Clean and normalize HTML for Rich Text Editors (Quill / RHFEditor)
   */
  cleanHtmlForEditor(html) {
    if (!html) return "";
    const $ = cheerio.load(html, null, false);
    // Remove unwanted interactive/script elements
    $("script, style, iframe, noscript, svg, nav, footer, header, form, button").remove();

    // Unwrap empty wrappers
    $('div:empty, span:empty, p:empty').remove();

    let cleaned = $.html().trim();
    // Normalize newlines to spaces inside text
    return cleaned;
  }

  cleanTrackingParams(url) {
    if (!url) return "";
    return url.split("?")[0].trim();
  }
}

export const jobDetailExtractor = new JobDetailExtractor();
export default jobDetailExtractor;
