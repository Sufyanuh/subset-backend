import axios from "axios";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import { logger } from "../utils/logger.js";

class JobMetadataEnricher {
  constructor() {
    this.openai = process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;
  }

  /**
   * Scrape studio website for logo, about, and social links
   */
  async scrapeStudioMetadata(url) {
    if (!url) return {};

    try {
      let target = url.trim();
      if (!target.startsWith("http://") && !target.startsWith("https://")) {
        target = `https://${target}`;
      }

      const response = await axios.get(target, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 8000,
        maxRedirects: 5,
      });

      const $ = cheerio.load(response.data);
      const origin = new URL(target).origin;

      // 1. Logo / Visual Assets
      const visualAssets = [];
      const ogImage = $('meta[property="og:image"]').attr("content") || $('meta[name="twitter:image"]').attr("content");
      if (ogImage) {
        visualAssets.push(this.resolveUrl(ogImage, origin));
      }

      const appleIcon = $('link[rel="apple-touch-icon"]').attr("href");
      if (appleIcon) {
        visualAssets.push(this.resolveUrl(appleIcon, origin));
      }

      const favicon = $('link[rel="icon"]').attr("href") || $('link[rel="shortcut icon"]').attr("href");
      if (favicon) {
        visualAssets.push(this.resolveUrl(favicon, origin));
      }

      // 2. About Company / Meta Description
      const aboutCompany =
        $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        $('meta[name="twitter:description"]').attr("content") ||
        "";

      // 3. Social Links
      let instagram = "";
      let linkedin = "";

      $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (!instagram && href.includes("instagram.com/")) {
          instagram = href;
        }
        if (!linkedin && href.includes("linkedin.com/")) {
          linkedin = href;
        }
      });

      return {
        visualAssets: [...new Set(visualAssets)].filter(Boolean),
        aboutCompany: aboutCompany.trim(),
        instagram: instagram.trim(),
        linkedin: linkedin.trim(),
      };
    } catch (error) {
      logger.warn(`Failed to scrape studio metadata from ${url}: ${error.message}`);
      return {};
    }
  }

  /**
   * Helper to resolve relative URLs to absolute
   */
  resolveUrl(relative, base) {
    try {
      return new URL(relative, base).href;
    } catch {
      return relative;
    }
  }

  /**
   * Extract structured job fields from diff and text
   */
  async extractJobDetails({ diff, diffFull, studioName, url, existingMetadata = {} }) {
    const rawText = diffFull || diff || "";

    // Default heuristics
    let workplaceType = "On-site";
    const lower = rawText.toLowerCase();
    if (lower.includes("remote")) {
      workplaceType = "Remote";
    } else if (lower.includes("hybrid")) {
      workplaceType = "Hybrid";
    }

    let contractType = "Full-time";
    if (lower.includes("part-time") || lower.includes("part time")) {
      contractType = "Part-time";
    } else if (lower.includes("contract") || lower.includes("contractor")) {
      contractType = "Contract";
    } else if (lower.includes("freelance")) {
      contractType = "Freelance";
    } else if (lower.includes("intern") || lower.includes("internship")) {
      contractType = "Internship";
    }

    // Salary regex
    let salaryRange = "";
    const salaryMatch = rawText.match(
      /(\$|£|€)\s*\d+[\d,]*(?:\s*k|\s*K)?(?:\s*-\s*|\s*to\s*)(?:\$|£|€)?\s*\d+[\d,]*(?:\s*k|\s*K)?/i
    );
    if (salaryMatch) {
      salaryRange = salaryMatch[0];
    }

    // Clean overview text
    let overview = rawText
      .split("\n")
      .map((l) => l.replace(/^[+ -]+/, "").trim())
      .filter(Boolean)
      .join("\n");

    let jobTitle = "";
    const cleanLines = rawText
      .split("\n")
      .map((l) => l.replace(/^[+ -]+/, "").trim())
      .filter((l) => l.length > 2);
    if (cleanLines.length > 0) {
      jobTitle = cleanLines[0].substring(0, 80);
    }

    // AI Enrichment (if OpenAI API Key is present)
    if (this.openai && rawText.length > 20) {
      try {
        const prompt = `Analyze this job posting diff / text from studio "${studioName}" (${url}) and extract structured JSON with keys:
- jobTitle: precise job title
- workplaceType: "On-site", "Hybrid", or "Remote"
- contractType: "Full-time", "Part-time", "Contract", "Freelance", or "Internship"
- salaryRange: salary if mentioned, else ""
- location: city/country if mentioned, else ""
- overview: comprehensive job description / role overview summary
- aboutCompany: brief company description if mentioned, else ""

Content:
${rawText.slice(0, 3000)}`;

        const response = await this.openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0.2,
        });

        const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
        if (parsed.jobTitle) jobTitle = parsed.jobTitle;
        if (parsed.workplaceType) workplaceType = parsed.workplaceType;
        if (parsed.contractType) contractType = parsed.contractType;
        if (parsed.salaryRange) salaryRange = parsed.salaryRange;
        if (parsed.overview) overview = parsed.overview;
        if (parsed.aboutCompany && !existingMetadata.aboutCompany) {
          existingMetadata.aboutCompany = parsed.aboutCompany;
        }
      } catch (aiErr) {
        logger.warn(`AI extraction fallback to heuristics: ${aiErr.message}`);
      }
    }

    return {
      jobTitle: jobTitle || "Open Role",
      workplaceType,
      contractType,
      salaryRange,
      overview: overview || rawText,
    };
  }
}

export const jobMetadataEnricher = new JobMetadataEnricher();
