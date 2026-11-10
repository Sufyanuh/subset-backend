import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import { GoogleGenAI } from "@google/genai";
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

    // Strategy 0: Specialized ATS Handlers
    // BambooHR: https://{subdomain}.bamboohr.com/careers/{id} or /jobs/{id}
    const bambooMatch = cleanUrl.match(
      /^https?:\/\/([a-zA-Z0-9_-]+)\.bamboohr\.com\/(?:careers|jobs)\/(\d+)/i
    );
    if (bambooMatch) {
      try {
        const bambooResult = await this.extractFromBambooHr(bambooMatch[1], bambooMatch[2], cleanUrl);
        if (bambooResult && bambooResult.jobTitle) {
          return bambooResult;
        }
      } catch (bambooErr) {
        logger.warn(`[JobDetailExtractor] BambooHR extraction fallback: ${bambooErr.message}`);
      }
    }

    try {
      let html = "";
      try {
        const response = await this.http.get(cleanUrl);
        html = typeof response.data === "string" ? response.data : "";
      } catch (httpErr) {
        logger.warn(`[JobDetailExtractor] Static fetch failed (${httpErr.message}). Trying Puppeteer dynamic render...`);
      }

      // Strategy 0.2: UltiPro / UKG embedded Opportunity JSON
      if (
        html &&
        (cleanUrl.includes("ultipro.com") ||
          html.includes("US.Opportunity.CandidateOpportunityDetail"))
      ) {
        try {
          const ultiProResult = this.extractFromUltiPro(html, cleanUrl);
          if (ultiProResult && ultiProResult.jobTitle) {
            return ultiProResult;
          }
        } catch (ultiProErr) {
          logger.warn(`[JobDetailExtractor] UltiPro extraction fallback: ${ultiProErr.message}`);
        }
      }

      // ─── TIER 2: Universal Schema.org JSON-LD (0 AI cost, ~80% sites) ──────
      if (html) {
        const $ = cheerio.load(html);
        const jsonLdResult = this.extractFromJsonLd($, cleanUrl);
        if (jsonLdResult && jsonLdResult.jobTitle) {
          return jsonLdResult;
        }

        // ─── TIER 3: Static Semantic HTML & OpenGraph (0 AI cost) ─────────────
        const isShell = this.isClientRenderedShell(html, cleanUrl);
        if (!isShell) {
          const htmlResult = this.extractFromHtml($, cleanUrl);
          if (htmlResult && htmlResult.jobTitle && htmlResult.overview && htmlResult.overview.length > 80) {
            return htmlResult;
          }
        }
      }

      // ─── TIER 4: Dynamic Puppeteer Headless Render (For Client SPAs / React / Vue) ───
      logger.info(`[JobDetailExtractor] Dynamic page detected for ${cleanUrl}. Rendering with Puppeteer...`);
      const renderedHtml = await this.renderWithPuppeteer(cleanUrl);
      if (renderedHtml) {
        const $rendered = cheerio.load(renderedHtml);

        // Check JSON-LD on rendered DOM
        const renderedJsonLd = this.extractFromJsonLd($rendered, cleanUrl);
        if (renderedJsonLd && renderedJsonLd.jobTitle) {
          return renderedJsonLd;
        }

        // Check Semantic HTML on rendered DOM
        const renderedHtmlResult = this.extractFromHtml($rendered, cleanUrl);
        if (
          renderedHtmlResult &&
          renderedHtmlResult.jobTitle &&
          renderedHtmlResult.overview &&
          renderedHtmlResult.overview.length > 80
        ) {
          return renderedHtmlResult;
        }

        // ─── TIER 5: Cost-Controlled Gemini Flash Fallback (< $0.0001, strictly limited) ───
        const cleanText = $rendered("body").text().replace(/\s+/g, " ").trim();
        if (cleanText.length > 100) {
          const aiResult = await this.extractWithGemini(cleanText, cleanUrl);
          if (aiResult && aiResult.jobTitle) {
            return aiResult;
          }
        }
      }

      // Final fallback: whatever HTML fallback got from static request
      if (html) {
        const $ = cheerio.load(html);
        return this.extractFromHtml($, cleanUrl);
      }

      throw new Error("Unable to extract job details from the provided URL");
    } catch (err) {
      logger.warn(`[JobDetailExtractor] Failed to extract from URL: ${cleanUrl} (${err.message})`);
      throw err;
    }
  }

  /**
   * Strategy 0: Extract from BambooHR JSON API
   * Endpoint: https://{subdomain}.bamboohr.com/careers/{jobId}/detail
   */
  async extractFromBambooHr(subdomain, jobId, cleanUrl) {
    const detailUrl = `https://${subdomain}.bamboohr.com/careers/${jobId}/detail`;
    const response = await this.http.get(detailUrl);
    const data = response.data?.result?.jobOpening;
    if (!data) return null;

    const jobTitle = String(data.jobOpeningName || "").trim();
    let overview = this.cleanHtmlForEditor(data.description || "");

    // Location: format as "City, State, Country"
    let location = "";
    if (data.location && typeof data.location === "object") {
      const parts = [
        data.location.city,
        data.location.state,
        data.location.addressCountry || "United States",
      ].filter(Boolean);
      location = parts.join(", ");
    }

    // Salary: e.g. "$75k - $85k"
    let salaryRange = String(data.compensation || "").trim();

    // Workplace Type (1 = On-site, 2 = Hybrid, 3 = Remote)
    let workplaceType = "On-site";
    const locTypeStr = String(data.locationType || "");
    if (locTypeStr === "3" || data.isRemote) {
      workplaceType = "Remote";
    } else if (
      locTypeStr === "2" ||
      /hybrid/i.test(overview) ||
      /hybrid/i.test(location)
    ) {
      workplaceType = "Hybrid";
    }

    // Contract Type
    let contractType = "Full-time";
    const statusLabel = String(data.employmentStatusLabel || "").toLowerCase();
    if (statusLabel.includes("part")) contractType = "Part-time";
    else if (statusLabel.includes("contract")) contractType = "Contract";
    else if (statusLabel.includes("intern")) contractType = "Internship";
    else if (statusLabel.includes("freelance")) contractType = "Freelance";

    // Company Name & Logo from main page OG metadata
    let companyName = "";
    let logo = "";
    try {
      const pageRes = await this.http.get(cleanUrl);
      const $ = cheerio.load(pageRes.data);
      companyName =
        $('meta[property="og:site_name"]').attr("content") ||
        $('meta[name="twitter:site"]').attr("content") ||
        "";
      logo = $('meta[property="og:image"]').attr("content") || "";
    } catch {
      companyName = subdomain
        .replace(/nyc$/i, " NYC")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    if (!companyName) {
      companyName = subdomain
        .replace(/nyc$/i, " NYC")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    const postedAt = data.datePosted ? new Date(data.datePosted) : null;

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
      applicationLink: data.jobOpeningShareUrl || cleanUrl,
      postedAt: postedAt && !isNaN(postedAt.getTime()) ? postedAt : null,
      source: "bamboohr_api",
    };
  }

  /**
   * Strategy 0.2: Extract from UltiPro / UKG embedded Opportunity JSON
   */
  extractFromUltiPro(html, cleanUrl) {
    const match = html.match(
      /new\s+US\.Opportunity\.CandidateOpportunityDetail\(\s*(\{[\s\S]*?\})\s*\);/
    );
    if (!match) return null;

    let data;
    try {
      data = JSON.parse(match[1]);
    } catch (e) {
      logger.warn(`[JobDetailExtractor] Failed to parse UltiPro JSON: ${e.message}`);
      return null;
    }

    const jobTitle = String(data.Title || "").trim();
    if (!jobTitle) return null;

    const overview = this.cleanHtmlForEditor(data.Description || "");

    // Location: format as "City, State, PostalCode, Country"
    let location = "";
    if (Array.isArray(data.Locations) && data.Locations.length > 0) {
      const loc = data.Locations[0];
      const addr = loc.Address || {};
      const parts = [
        addr.City,
        addr.State?.Code || addr.State?.Name,
        addr.PostalCode,
        addr.Country?.Name || addr.Country?.Code || "United States",
      ].filter(Boolean);
      location = parts.join(", ");
      if (!location && (loc.LocalizedDescription || loc.LocalizedName)) {
        location = loc.LocalizedDescription || loc.LocalizedName;
      }
    }

    // Workplace Type (0 = Hybrid, 1 = On-site, 2 = Remote)
    let workplaceType = "On-site";
    if (data.JobLocationType === 0) workplaceType = "Hybrid";
    else if (data.JobLocationType === 1) workplaceType = "On-site";
    else if (data.JobLocationType === 2) workplaceType = "Remote";
    else if (/hybrid/i.test(location) || /hybrid/i.test(overview)) workplaceType = "Hybrid";
    else if (/remote|worldwide/i.test(location) || /remote/i.test(overview)) workplaceType = "Remote";

    // Contract Type
    let contractType = "Full-time";
    if (data.FullTime === false) contractType = "Part-time";
    else if (data.FullTime === true) contractType = "Full-time";

    // Salary extraction
    let salaryRange = "";
    if (data.CompensationAmount) {
      const curr = data.CompensationCurrencyCode || "$";
      salaryRange = `${curr}${data.CompensationAmount}`;
    } else if (data.CompensationAnnualMinimum && data.CompensationAnnualMaximum) {
      const curr = data.CompensationCurrencyCode || "$";
      salaryRange = `${curr}${data.CompensationAnnualMinimum} – ${curr}${data.CompensationAnnualMaximum}`;
    } else if (data.PayRange && typeof data.PayRange === "object") {
      if (data.PayRange.PayRangeMinimum && data.PayRange.PayRangeMaximum) {
        const curr = data.PayRangeCurrencyCode || "$";
        salaryRange = `${curr}${data.PayRange.PayRangeMinimum} – ${curr}${data.PayRange.PayRangeMaximum}`;
      }
    } else if (typeof data.PayRange === "string" && data.PayRange.trim()) {
      salaryRange = data.PayRange.trim();
    }

    if (!salaryRange) {
      salaryRange = this.extractSalary({}, overview, "");
    }

    // Company Name & Logo
    let companyName = "";
    let logo = "";

    const logoSrcMatch = html.match(/largeLogoSrc:\s*["']([^"']+)["']/);
    const logoHrefMatch = html.match(/logoHref:\s*["']([^"']+)["']/);

    if (logoSrcMatch && logoSrcMatch[1]) {
      const unescapedLogo = logoSrcMatch[1].replace(/\\u0026/g, "&");
      logo = new URL(unescapedLogo, cleanUrl).href;
    }

    let website = "";
    if (logoHrefMatch && logoHrefMatch[1]) {
      website = logoHrefMatch[1];
    }

    // Check description text for company name (e.g. "The Museum of Modern Art is currently accepting applications")
    const cleanOverviewText = overview.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ");
    const descCompanyMatch = cleanOverviewText.match(
      /(?:^|\.\s*)((?:The\s+)?[A-Za-z0-9\s&,.'-]+?)\s+is\s+(?:currently\s+)?accepting\s+applications/i
    );
    if (descCompanyMatch && descCompanyMatch[1]) {
      companyName = descCompanyMatch[1].trim();
    }

    if (!companyName && website) {
      try {
        const hostname = new URL(website).hostname.replace(/^www\./i, "");
        const namePart = hostname.split(".")[0];
        if (namePart) {
          companyName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
        }
      } catch {}
    }

    if (!companyName) {
      const tenantMatch = cleanUrl.match(/recruiting\.ultipro\.com\/([^\/]+)/i);
      if (tenantMatch && tenantMatch[1]) {
        companyName = tenantMatch[1].replace(/^[A-Z]{2,4}\d+/, "");
      }
    }

    const postedAt = data.PostedDate ? new Date(data.PostedDate) : null;

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
      website,
      applicationLink: cleanUrl,
      postedAt: postedAt && !isNaN(postedAt.getTime()) ? postedAt : null,
      source: "ultipro_api",
    };
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

    // Pattern 1: Explicit labels: "Compensation: $22.60/hr", "Salary: $120k - $140k", "The salary for this position is $128,000 (gross) per annum"
    const compMatch = fullText.match(
      /(?:compensation|salary|pay|rate|hourly|annual|base pay)[^$€£¥\r\n]{0,60}([$€£¥]\s*\d[\d,.]*\s*(?:k|K)?(?:\s*(?:–|-|to)\s*[$€£¥]?\s*\d[\d,.]*\s*(?:k|K)?)?(?:\s*(?:\([^)]*\)\s*)?(?:\/|\s*per\s*)(?:hr|hour|yr|year|annum|month))?)/i
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

  /**
   * Helper: Check if raw HTML looks like an empty client-rendered JS framework shell
   */
  isClientRenderedShell(html, url = "") {
    if (!html || html.length < 500) return true;
    const lower = html.toLowerCase();
    const urlLower = (url || "").toLowerCase();

    if (
      urlLower.includes("refinementlist") ||
      urlLower.includes("facetfilters") ||
      urlLower.includes("instantsearch") ||
      urlLower.includes("jobsearch") ||
      urlLower.includes("#/")
    ) {
      return true;
    }

    const hasDynamicWidget =
      lower.includes("ais-instantsearch") ||
      lower.includes("instantsearch.js") ||
      lower.includes("algoliasearch") ||
      lower.includes("filtered-search") ||
      lower.includes('id="hits"') ||
      lower.includes('class="hits"') ||
      lower.includes("data-reactroot") ||
      lower.includes('id="root"') ||
      lower.includes('id="__next"') ||
      lower.includes('id="app"');

    if (hasDynamicWidget) {
      const strippedText = html
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (strippedText.length < 600) {
        return true;
      }
    }

    const strippedText = html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (strippedText.length < 250) {
      return true;
    }

    return false;
  }

  /**
   * Helper: Render dynamic client-side SPA with Puppeteer
   */
  async renderWithPuppeteer(url) {
    let browser = null;
    try {
      const launchOptions = {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--window-size=1920,1080",
        ],
      };

      try {
        browser = await puppeteer.launch(launchOptions);
      } catch {
        browser = await puppeteer.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
      }

      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      );
      await page.setViewport({ width: 1920, height: 1080 });

      // Abort heavy media to save memory, bandwidth, and load fast
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (["image", "media", "font"].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });
      await new Promise((r) => setTimeout(r, 800));

      const html = await page.content();
      return html;
    } catch (err) {
      logger.warn(`[JobDetailExtractor] Puppeteer rendering failed for ${url}: ${err.message}`);
      return null;
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
    }
  }

  /**
   * Helper: Cost-controlled AI fallback using Google Gemini Flash
   * Only called when standard extractors fail on obscure custom layouts.
   * Strictly limits prompt to 3,500 chars (~700 tokens) -> Cost < $0.00006 per call.
   */
  async extractWithGemini(cleanText, url) {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!key) return null;

    try {
      if (!this.geminiClient) {
        this.geminiClient = new GoogleGenAI({ apiKey: key });
      }

      const modelName = process.env.GEMINI_MODEL || "gemini-3.8-flash";
      const snippet = cleanText.substring(0, 3500);

      const response = await this.geminiClient.models.generateContent({
        model: modelName,
        contents: `You are an expert recruitment data parser. Extract the structured job posting details from this text snippet. If any field is not found in the text, return empty string "".
Job URL: ${url}

Content:
${snippet}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              jobTitle: { type: "string", description: "Exact job/role title" },
              companyName: { type: "string", description: "Company or hiring studio name" },
              overview: { type: "string", description: "Formatted HTML overview/description with <p>, <ul>, <li> tags" },
              salaryRange: { type: "string", description: "Salary or compensation range (e.g. '$120k - $140k' or '$50/hr'), or empty if none" },
              location: { type: "string", description: "Job location (e.g. 'New York, NY, USA' or 'Remote')" },
              workplaceType: { type: "string", enum: ["On-site", "Hybrid", "Remote"] },
              contractType: { type: "string", enum: ["Full-time", "Part-time", "Contract", "Freelance", "Internship"] },
            },
            required: ["jobTitle", "workplaceType", "contractType"],
          },
        },
      });

      if (!response.text) return null;
      const parsed = JSON.parse(response.text);
      if (parsed.jobTitle) {
        logger.info(`[JobDetailExtractor] Extracted "${parsed.jobTitle}" via Gemini Flash (minimal token cost)`);
        return {
          success: true,
          jobTitle: parsed.jobTitle,
          companyName: parsed.companyName || "",
          overview: this.cleanHtmlForEditor(parsed.overview || snippet),
          salaryRange: parsed.salaryRange || "",
          location: parsed.location || "",
          workplaceType: parsed.workplaceType || "On-site",
          contractType: parsed.contractType || "Full-time",
          logo: "",
          applicationLink: url,
          postedAt: null,
          source: "gemini_flash",
        };
      }
    } catch (e) {
      logger.warn(`[JobDetailExtractor] Gemini Flash extraction fallback failed: ${e.message}`);
    }
    return null;
  }

  cleanTrackingParams(url) {
    if (!url) return "";
    return url.split("?")[0].trim();
  }
}

export const jobDetailExtractor = new JobDetailExtractor();
export default jobDetailExtractor;
