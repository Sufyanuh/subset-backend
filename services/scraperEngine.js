import fs from "fs";
import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import { Studio } from "../model/studio.js";
import { Job } from "../model/job.js";
import { JobCategory } from "../model/jobCategory.js";
import { atsDetector } from "./atsDetector.js";
import { aiSelectorService } from "./aiSelectorService.js";
import { domCleaner } from "./domCleaner.js";
import { studioMetadataEnricher } from "./studioMetadataEnricher.js";
import { logger } from "../utils/logger.js";

/**
 * 2-Tier Scraper Engine
 * Tier 1: ATS Direct API & Cheerio Cached Selector Scraper (Zero AI Cost)
 * Tier 2: Self-Healing Gemini Flash Selector Discovery & Puppeteer SPA Fallback
 *
 * Scraped jobs land in "pending" status so admin can review and approve them before publishing.
 */
class ScraperEngine {
  constructor() {
    this.http = axios.create({
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  }

  /**
   * Main entrypoint to scrape a single studio
   * @param {string|object} studioOrId - Studio document or ObjectId string
   * @param {object} [options={}] - Execution options
   * @returns {Promise<object>} Scraping results
   */
  async scrapeStudio(studioOrId, options = {}) {
    const { forceAiDiscovery = false } = options;

    let studio =
      typeof studioOrId === "string" ? await Studio.findById(studioOrId) : studioOrId;

    if (!studio) {
      return { success: false, message: "Studio not found" };
    }

    const startTime = Date.now();
    logger.info(`Starting scrape for studio: ${studio.name} (${studio.careersUrl})`);

    try {
      // 0. Ensure studio metadata & visual assets (logo, favicon, og:image) are enriched
      await this.ensureStudioVisualAssets(studio);

      let rawJobs = [];
      let usedMethod = "cached_selectors";

      // -----------------------------------------------------------------
      // PATH A: KNOWN ATS (Greenhouse, Lever, Ashby)
      // -----------------------------------------------------------------
      if (
        studio.atsType &&
        studio.atsType !== "custom" &&
        studio.atsType !== "unknown" &&
        studio.atsIdentifier
      ) {
        usedMethod = `ats_${studio.atsType}`;
        rawJobs = await atsDetector.fetchAtsJobs(
          studio.atsType,
          studio.atsIdentifier,
          studio
        );
      } else {
        // ---------------------------------------------------------------
        // PATH B: CUSTOM CAREER PAGE (CHEERIO + CACHED SELECTORS)
        // ---------------------------------------------------------------
        // Check anti-bot block before proceeding
        let html = "";
        let fetchStatus = 200;
        try {
          html = await this.fetchHtml(
            studio.careersUrl,
            studio.scrapingConfig?.requiresPuppeteer
          );
        } catch (fetchErr) {
          fetchStatus = fetchErr.response?.status || 500;
          html = typeof fetchErr.response?.data === "string" ? fetchErr.response.data : "";
          const antiBot = this.checkAntiBotProtection(html, fetchStatus, studio.careersUrl);
          if (antiBot) {
            studio.scrapingConfig.status = "failed";
            studio.scrapingConfig.lastError = antiBot;
            studio.scrapingConfig.lastScrapedAt = new Date();
            await studio.save();
            return {
              success: false,
              studioId: studio._id,
              studioName: studio.name,
              message: antiBot,
              error: antiBot,
            };
          }
          if (fetchStatus === 404) {
            const notFoundMsg = `Careers URL (${studio.careersUrl}) returned 404 Not Found. The page does not exist or has moved.`;
            studio.scrapingConfig.status = "failed";
            studio.scrapingConfig.lastError = notFoundMsg;
            studio.scrapingConfig.lastScrapedAt = new Date();
            await studio.save();
            return {
              success: false,
              studioId: studio._id,
              studioName: studio.name,
              message: notFoundMsg,
              error: notFoundMsg,
            };
          }
          throw fetchErr;
        }

        const antiBotBlock = this.checkAntiBotProtection(html, fetchStatus, studio.careersUrl);
        if (antiBotBlock) {
          studio.scrapingConfig.status = "failed";
          studio.scrapingConfig.lastError = antiBotBlock;
          studio.scrapingConfig.lastScrapedAt = new Date();
          await studio.save();
          return {
            success: false,
            studioId: studio._id,
            studioName: studio.name,
            message: antiBotBlock,
            error: antiBotBlock,
          };
        }

        // Check if page embeds an ATS widget not previously detected
        const detected = atsDetector.detectAts(studio.careersUrl, html);
        if (detected.atsType !== "custom" && detected.atsIdentifier) {
          logger.info(`Auto-detected ${detected.atsType} for studio: ${studio.name}`);
          studio.atsType = detected.atsType;
          studio.atsIdentifier = detected.atsIdentifier;
          studio.scrapingConfig.status = "discovered";
          await studio.save();

          usedMethod = `ats_${detected.atsType}`;
          rawJobs = await atsDetector.fetchAtsJobs(
            detected.atsType,
            detected.atsIdentifier,
            studio
          );
        } else {
          // Check if we have valid cached selectors
          const hasCachedSelectors = Boolean(
            studio.scrapingConfig?.selectors?.jobContainer &&
              studio.scrapingConfig?.selectors?.titleSelector
          );

          if (hasCachedSelectors && !forceAiDiscovery) {
            rawJobs = this.extractJobsWithSelectors(
              html,
              studio.scrapingConfig.selectors,
              studio
            );
          }

          // -------------------------------------------------------------
          // PATH C: SELF-HEALING FALLBACK (AI SELECTOR DISCOVERY)
          // -------------------------------------------------------------
          // If no selectors or routine scraping found 0 jobs, check SPA or re-discover
          if (rawJobs.length === 0) {
            // Check if page is an empty client-rendered JS shell
            const looksLikeSpa = this.isClientRenderedShell(html);
            if (looksLikeSpa && !studio.scrapingConfig?.requiresPuppeteer) {
              logger.info(`Page appears to be SPA for ${studio.name}. Fetching via Puppeteer...`);
              html = await this.fetchWithPuppeteer(studio.careersUrl);
              studio.scrapingConfig.requiresPuppeteer = true;

              // Check if Puppeteer got a captcha / anti-bot block
              const puppeteerBlock = this.checkAntiBotProtection(html, 200, studio.careersUrl);
              if (puppeteerBlock) {
                studio.scrapingConfig.status = "failed";
                studio.scrapingConfig.lastError = puppeteerBlock;
                studio.scrapingConfig.lastScrapedAt = new Date();
                await studio.save();
                return {
                  success: false,
                  studioId: studio._id,
                  studioName: studio.name,
                  message: puppeteerBlock,
                  error: puppeteerBlock,
                };
              }

              // Re-check cached selectors with Puppeteer HTML
              if (hasCachedSelectors && !forceAiDiscovery) {
                rawJobs = this.extractJobsWithSelectors(
                  html,
                  studio.scrapingConfig.selectors,
                  studio
                );
              }
            }

            // If still 0 jobs, trigger AI Selector Discovery
            if (rawJobs.length === 0) {
              logger.info(`Triggering AI Selector Discovery for studio: ${studio.name}`);
              usedMethod = "ai_discovery";

              studio.scrapingConfig.discoveryAttempts =
                (studio.scrapingConfig.discoveryAttempts || 0) + 1;

              let discoveryRes = await aiSelectorService.discoverSelectors(html, {
                studioName: studio.name,
                url: studio.careersUrl,
              });

              if (discoveryRes.requiresPuppeteer && !studio.scrapingConfig?.requiresPuppeteer) {
                logger.info(
                  `AI indicated page requires JavaScript rendering for ${studio.name}. Fetching with Puppeteer...`
                );
                try {
                  html = await this.fetchWithPuppeteer(studio.careersUrl);
                  studio.scrapingConfig.requiresPuppeteer = true;
                  discoveryRes = await aiSelectorService.discoverSelectors(html, {
                    studioName: studio.name,
                    url: studio.careersUrl,
                  });
                } catch (puppeteerErr) {
                  logger.warn(
                    `Puppeteer fallback failed for ${studio.name}: ${puppeteerErr.message}`
                  );
                }
              }

              if (discoveryRes.success && discoveryRes.selectors) {
                studio.scrapingConfig.selectors = discoveryRes.selectors;
                studio.scrapingConfig.status = "discovered";
                studio.scrapingConfig.lastDiscoveredAt = new Date();
                studio.scrapingConfig.lastError = "";

                // Extract with the newly learned selectors
                rawJobs = this.extractJobsWithSelectors(
                  html,
                  discoveryRes.selectors,
                  studio
                );
              } else {
                if (discoveryRes.hasJobs === false) {
                  logger.info(`No active openings found by AI for: ${studio.name}`);
                  studio.scrapingConfig.lastError =
                    "No active job vacancies were found on this career page.";
                  studio.scrapingConfig.status = "unsupported";
                } else {
                  studio.scrapingConfig.lastError =
                    discoveryRes.error || "AI discovery failed to find job selectors";
                  studio.scrapingConfig.status = "failed";
                }
              }
            }
          }
        }
      }

      // Check if 0 jobs were extracted and fail clearly
      if (rawJobs.length === 0) {
        const errorReason =
          studio.scrapingConfig.lastError ||
          "No job listings could be extracted from this page. The studio may have no active vacancies, or the page uses an unsupported widget.";
        studio.scrapingConfig.lastScrapedAt = new Date();
        studio.scrapingConfig.lastScrapedJobCount = 0;
        studio.scrapingConfig.lastError = errorReason;
        studio.scrapingConfig.status = "failed";
        await studio.save();

        return {
          success: false,
          studioId: studio._id,
          studioName: studio.name,
          message: errorReason,
          error: errorReason,
          method: usedMethod,
          stats: {
            rawFound: 0,
            savedToDb: 0,
            durationMs: Date.now() - startTime,
          },
        };
      }

      // -----------------------------------------------------------------
      // CATEGORY FILTERING & DEDUPLICATION PERSISTENCE
      // (Scraped jobs are saved with status="pending" for admin review)
      // -----------------------------------------------------------------
      const { savedCount, matchedCount, skippedCount } = await this.filterAndSaveJobs(
        rawJobs,
        studio
      );

      // Update studio scraping metadata
      studio.scrapingConfig.lastScrapedAt = new Date();
      studio.scrapingConfig.lastScrapedJobCount = savedCount;
      if (rawJobs.length > 0) {
        studio.scrapingConfig.lastError = "";
      }
      await studio.save();

      const durationMs = Date.now() - startTime;
      logger.info(`Completed scrape for ${studio.name} in ${durationMs}ms`, {
        rawFound: rawJobs.length,
        matchedCategory: matchedCount,
        savedToDb: savedCount,
        skipped: skippedCount,
        method: usedMethod,
      });

      return {
        success: true,
        studioId: studio._id,
        studioName: studio.name,
        method: usedMethod,
        stats: {
          rawFound: rawJobs.length,
          matchedCategory: matchedCount,
          savedToDb: savedCount,
          skipped: skippedCount,
          durationMs,
        },
      };
    } catch (error) {
      studio.scrapingConfig.lastScrapedAt = new Date();
      studio.scrapingConfig.lastError = error.message;
      await studio.save();

      logger.error(`Scraping failed for studio: ${studio.name}`, error);
      return {
        success: false,
        studioId: studio._id,
        studioName: studio.name,
        error: error.message,
      };
    }
  }

  /**
   * Ensure studio has visual assets (logo, favicon, og:image) extracted from its website
   */
  async ensureStudioVisualAssets(studio) {
    if (
      (!studio.visualAssets || studio.visualAssets.length === 0) &&
      (studio.website || studio.careersUrl)
    ) {
      const targetSite = studio.website || studio.careersUrl;
      const meta = await studioMetadataEnricher.enrichStudioMetadata(targetSite);

      if (meta.visualAssets && meta.visualAssets.length > 0) {
        studio.visualAssets = meta.visualAssets;
        studio.logo = meta.logo || "";
        studio.favicon = meta.favicon || "";
        if (!studio.aboutCompany && meta.aboutCompany) {
          studio.aboutCompany = meta.aboutCompany;
        }
        if (!studio.instagram && meta.instagram) {
          studio.instagram = meta.instagram;
        }
        if (!studio.linkedin && meta.linkedin) {
          studio.linkedin = meta.linkedin;
        }
        await studio.save();
      }
    }
  }

  /**
   * Helper: Check if response indicates anti-bot or CAPTCHA block
   */
  checkAntiBotProtection(html, statusCode = 200, url = "") {
    const urlLower = (url || "").toLowerCase();
    const isMajorJobBoard =
      urlLower.includes("indeed.com") ||
      urlLower.includes("linkedin.com") ||
      urlLower.includes("glassdoor.com") ||
      urlLower.includes("ziprecruiter.com");

    if (statusCode === 403) {
      if (isMajorJobBoard) {
        return "Blocked by Cloudflare / Anti-Bot protection (Indeed/LinkedIn security check). Major job aggregators block scrapers; please use direct studio/company career links.";
      }
      return "HTTP 403 Forbidden: Access denied by website anti-bot protection.";
    }

    if (!html || typeof html !== "string") return false;
    const lower = html.toLowerCase();
    if (
      lower.includes("security check - indeed") ||
      lower.includes("additional verification required") ||
      lower.includes("enable javascript and cookies to continue") ||
      lower.includes("challenge-error-text") ||
      lower.includes("cf-browser-verification") ||
      lower.includes("just a moment...") ||
      lower.includes("attention required! | cloudflare") ||
      lower.includes("access denied | cloudflare") ||
      lower.includes("datadome") ||
      lower.includes("perimeterx")
    ) {
      return "Blocked by Cloudflare / Anti-Bot Security Check. This platform prohibits automated scraping.";
    }
    return false;
  }

  /**
   * Fetch webpage HTML using standard Axios or Puppeteer
   */
  async fetchHtml(url, requiresPuppeteer = false) {
    if (requiresPuppeteer) {
      return this.fetchWithPuppeteer(url);
    }

    try {
      const response = await this.http.get(url);
      return typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    } catch (error) {
      // If 403/block or network issue, fallback to Puppeteer if possible
      if (error.response?.status === 403 || error.code === "ECONNRESET") {
        logger.warn(`Cheerio fetch blocked (${error.message}). Falling back to Puppeteer...`);
        return this.fetchWithPuppeteer(url);
      }
      throw error;
    }
  }

  /**
   * Helper to detect local Chrome or Edge executable on Windows/Linux/Mac
   */
  getBrowserExecutablePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    const candidates = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        // ignore
      }
    }
    return undefined;
  }

  /**
   * Headless Puppeteer fetch for JavaScript rendered pages (SPAs)
   */
  async fetchWithPuppeteer(url) {
    let browser = null;
    try {
      const execPath = this.getBrowserExecutablePath();
      const launchOptions = {
        headless: true,
        ...(execPath ? { executablePath: execPath } : {}),
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
      } catch (err) {
        logger.warn(`Primary Puppeteer launch failed (${err.message}). Trying fallback launch...`);
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

      // Navigate and wait for content
      await page.goto(url, { waitUntil: "networkidle2", timeout: 25000 });

      // Give JS frameworks a moment to hydrate
      await new Promise((r) => setTimeout(r, 2000));

      const content = await page.content();
      return content;
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  /**
   * Extract raw jobs from HTML using cached CSS selectors
   */
  extractJobsWithSelectors(html, selectors, studio) {
    if (!html || !selectors?.jobContainer || !selectors?.titleSelector) {
      return [];
    }

    const $ = cheerio.load(html);
    const jobs = [];
    const baseUrl = studio.careersUrl || studio.website || "";

    const {
      jobContainer,
      titleSelector,
      locationSelector,
      applyUrlSelector,
      salarySelector,
      departmentSelector,
      workplaceTypeSelector,
      contractTypeSelector,
      descriptionSelector,
      imageSelector,
      companyNameSelector,
      datePostedSelector,
    } = selectors;

    let containers;
    try {
      containers = $(jobContainer);
    } catch (err) {
      logger.warn(`Invalid selector '${jobContainer}': ${err.message}`);
      return [];
    }

    containers.each((_, el) => {
      const $el = $(el);

      // 1. Title
      let title = "";
      if (titleSelector) {
        try {
          title = $el.find(titleSelector).first().text().trim();
        } catch {
          title = "";
        }
      }
      if (!title) {
        title = $el.find("h1, h2, h3, h4, strong, a").first().text().trim();
      }

      if (!title || title.length < 2) return;

      // 2. Company Name
      let companyName = studio.name;
      if (companyNameSelector) {
        try {
          const comp = $el.find(companyNameSelector).first().text().trim();
          if (comp) companyName = comp;
        } catch {
          companyName = studio.name;
        }
      }

      // 3. Apply / Detail URL
      let applyUrl = "";
      if (applyUrlSelector) {
        try {
          applyUrl = $el.find(applyUrlSelector).first().attr("href") || "";
        } catch {
          applyUrl = "";
        }
      } else if ($el.is("a")) {
        applyUrl = $el.attr("href") || "";
      } else {
        applyUrl = $el.find("a").first().attr("href") || "";
      }

      applyUrl = this.resolveUrl(applyUrl, baseUrl);

      // 4. Location
      let location = "";
      if (locationSelector) {
        try {
          location = $el.find(locationSelector).first().text().trim();
        } catch {
          location = "";
        }
      }
      location = location || studio.location || "";

      // 5. Salary
      let salaryRange = "";
      if (salarySelector) {
        try {
          salaryRange = $el.find(salarySelector).first().text().trim();
        } catch {
          salaryRange = "";
        }
      }

      // 6. Department / Category
      let department = "";
      if (departmentSelector) {
        try {
          department = $el.find(departmentSelector).first().text().trim();
        } catch {
          department = "";
        }
      }

      // 7. Workplace Type (On-site, Hybrid, Remote)
      let workplaceType = "";
      if (workplaceTypeSelector) {
        try {
          workplaceType = $el.find(workplaceTypeSelector).first().text().trim();
        } catch {
          workplaceType = "";
        }
      }
      workplaceType = atsDetector.normalizeWorkplaceType(
        workplaceType || atsDetector.inferWorkplaceType(location, title)
      );

      // 8. Contract Type (Full-time, Part-time, Contract, Freelance, Internship)
      let contractType = "Full-time";
      if (contractTypeSelector) {
        try {
          const ct = $el.find(contractTypeSelector).first().text().trim();
          if (ct) contractType = atsDetector.normalizeContractType(ct);
        } catch {
          contractType = "Full-time";
        }
      }

      // 9. Overview / Description
      let overview = "";
      if (descriptionSelector) {
        try {
          overview = $el.find(descriptionSelector).first().text().trim();
        } catch {
          overview = "";
        }
      }
      if (!overview) {
        overview = $el.text().replace(/\s+/g, " ").trim().slice(0, 1000);
      }
      overview = atsDetector.cleanOverview(overview);

      // 10. Visual Assets (Job-specific image OR studio logo/favicon fallback)
      const visualAssets = [];
      if (imageSelector) {
        try {
          const imgSrc =
            $el.find(imageSelector).first().attr("src") ||
            $el.find(imageSelector).first().attr("data-src") ||
            "";
          if (imgSrc) {
            visualAssets.push(this.resolveUrl(imgSrc, baseUrl));
          }
        } catch {
          // ignore
        }
      }

      // Append studio visual assets (logo, favicon, og:image)
      if (studio.visualAssets && studio.visualAssets.length > 0) {
        visualAssets.push(...studio.visualAssets);
      } else if (studio.logo) {
        visualAssets.push(studio.logo);
      }

      const deduplicatedVisualAssets = Array.from(new Set(visualAssets.filter(Boolean)));

      // 11. Posted Date extraction & parsing
      let postedDateText = "";
      if (datePostedSelector) {
        try {
          const $dateEl = $el.find(datePostedSelector).first();
          postedDateText = $dateEl.attr("datetime") || $dateEl.text().trim();
        } catch {
          postedDateText = "";
        }
      }
      if (!postedDateText) {
        const $time = $el.find("time").first();
        if ($time.length) {
          postedDateText = $time.attr("datetime") || $time.text().trim();
        }
      }
      const postedAt = this.parsePostedDate(postedDateText);

      jobs.push({
        jobTitle: title,
        companyName,
        website: studio.website || studio.careersUrl || "",
        applicationLink: applyUrl || studio.careersUrl,
        location,
        workplaceType,
        contractType,
        department,
        salaryRange,
        overview,
        visualAssets: deduplicatedVisualAssets,
        postedAt,
      });
    });

    return jobs;
  }

  /**
   * Helper: Parse various date representations (ISO, formatted strings, relative strings like '3 days ago')
   */
  parsePostedDate(input) {
    if (!input || typeof input !== "string") return null;
    const clean = input.trim();
    if (!clean) return null;

    // 1. Direct JS Date parse (handles ISO "2024-03-01", standard date strings)
    const directDate = new Date(clean);
    if (
      !isNaN(directDate.getTime()) &&
      directDate.getFullYear() > 2000 &&
      directDate.getFullYear() <= new Date().getFullYear() + 1
    ) {
      return directDate;
    }

    // 2. Relative times: "3 days ago", "posted 2 weeks ago", "1 month ago", "today", "yesterday"
    const lower = clean.toLowerCase();
    const now = Date.now();

    if (lower.includes("just now") || lower.includes("today") || lower.includes("moment ago")) {
      return new Date(now);
    }
    if (lower.includes("yesterday")) {
      return new Date(now - 24 * 60 * 60 * 1000);
    }

    const relMatch = lower.match(/(\d+)\+?\s*(minute|hour|day|week|month|year)s?\s*ago/);
    if (relMatch) {
      const num = parseInt(relMatch[1], 10);
      const unit = relMatch[2];
      let ms = 0;
      if (unit === "minute") ms = num * 60 * 1000;
      else if (unit === "hour") ms = num * 60 * 60 * 1000;
      else if (unit === "day") ms = num * 24 * 60 * 60 * 1000;
      else if (unit === "week") ms = num * 7 * 24 * 60 * 60 * 1000;
      else if (unit === "month") ms = num * 30 * 24 * 60 * 60 * 1000;
      else if (unit === "year") ms = num * 365 * 24 * 60 * 60 * 1000;

      if (ms > 0) {
        return new Date(now - ms);
      }
    }

    if (lower.includes("30+ days ago") || lower.includes("30+ days")) {
      return new Date(now - 35 * 24 * 60 * 60 * 1000);
    }

    return null;
  }

  /**
   * Filter jobs matching existing JobCategories and persist with deduplication.
   * Scraped jobs land in "pending" status so admin can review and approve them before publishing.
   */
  async filterAndSaveJobs(rawJobs, studio) {
    if (!rawJobs || rawJobs.length === 0) {
      return { savedCount: 0, matchedCount: 0, skippedCount: 0 };
    }

    // 1. Fetch active categories from database
    const categories = await JobCategory.find({}).lean();

    let matchedCount = 0;
    let savedCount = 0;
    let skippedCount = 0;

    // Cutoff age: skip old jobs if posted date exceeds maxJobAgeDays (default 30 days)
    const maxJobAgeDays =
      studio.scrapingConfig?.maxJobAgeDays !== undefined
        ? studio.scrapingConfig.maxJobAgeDays
        : 30;

    for (const jobItem of rawJobs) {
      if (!jobItem.jobTitle) {
        skippedCount++;
        continue;
      }

      // Check posted date cutoff (Skip old jobs!)
      if (jobItem.postedAt && maxJobAgeDays > 0) {
        const postedTime = new Date(jobItem.postedAt).getTime();
        const cutoffTime = Date.now() - maxJobAgeDays * 24 * 60 * 60 * 1000;
        if (postedTime < cutoffTime) {
          logger.info(
            `Skipping old job '${jobItem.jobTitle}' for ${studio.name} posted on ${
              new Date(jobItem.postedAt).toISOString().split("T")[0]
            } (> ${maxJobAgeDays} days cutoff)`
          );
          skippedCount++;
          continue;
        }
      }

      // 2. Match with JobCategory (fallback to default or null, never drop valid jobs!)
      const matchedCats = this.matchJobCategories(jobItem, categories);
      const primaryCatId =
        matchedCats[0]?._id || (categories.length > 0 ? categories[0]._id : null);
      const catIds =
        matchedCats.length > 0
          ? matchedCats.map((c) => c._id)
          : primaryCatId
          ? [primaryCatId]
          : [];

      matchedCount++;

      // 3. Deduplication filter
      // Use applicationLink or compound studio + title + location
      const query = jobItem.applicationLink
        ? {
            $or: [
              { applicationLink: jobItem.applicationLink },
              {
                companyName: studio.name,
                jobTitle: jobItem.jobTitle,
                location: jobItem.location || "",
              },
            ],
          }
        : {
            companyName: studio.name,
            jobTitle: jobItem.jobTitle,
          };

      // Combine job specific visual assets or fallback to studio visual assets
      const visualAssets =
        Array.isArray(jobItem.visualAssets) && jobItem.visualAssets.length > 0
          ? jobItem.visualAssets
          : (studio.visualAssets || []);

      const jobData = {
        studio: studio._id,
        companyName: jobItem.companyName || studio.name,
        aboutCompany: atsDetector.cleanOverview(studio.aboutCompany || ""),
        website: studio.website || studio.careersUrl || "",
        jobTitle: jobItem.jobTitle,
        jobCategory: primaryCatId,
        jobCategories: catIds,
        applicationLink: jobItem.applicationLink || studio.careersUrl,
        location: jobItem.location || studio.location || "",
        workplaceType: jobItem.workplaceType || "On-site",
        contractType: jobItem.contractType || "Full-time",
        salaryRange: jobItem.salaryRange || "",
        overview: atsDetector.cleanOverview(jobItem.overview || ""),
        visualAssets,
        postedAt: jobItem.postedAt ? new Date(jobItem.postedAt) : null,
        instagram: studio.instagram || "",
        linkedin: studio.linkedin || "",
        companySize: studio.companySize || "",
      };

      // Upsert: newly scraped jobs default to "pending" for admin review!
      // If a job was already approved, it remains active!
      await Job.updateOne(
        query,
        {
          $set: jobData,
          $setOnInsert: {
            status: "pending", // Requires admin review before publish!
          },
        },
        { upsert: true }
      );
      savedCount++;
    }

    return { savedCount, matchedCount, skippedCount };
  }

  /**
   * Smart category matching: checks job title, department, and overview against category names
   */
  matchJobCategories(job, categories) {
    if (!categories || categories.length === 0) return [];

    const titleLower = (job.jobTitle || "").toLowerCase();
    const deptLower = (job.department || "").toLowerCase();
    const overviewLower = (job.overview || "").toLowerCase();

    const matches = [];

    for (const cat of categories) {
      if (!cat.name) continue;
      const catNameLower = cat.name.toLowerCase();

      // Check title first (highest precision)
      if (titleLower.includes(catNameLower)) {
        matches.push(cat);
        continue;
      }

      // Check department next
      if (deptLower && deptLower.includes(catNameLower)) {
        matches.push(cat);
        continue;
      }

      // Check overview
      if (overviewLower && overviewLower.includes(catNameLower)) {
        matches.push(cat);
      }
    }

    return matches;
  }

  /**
   * Helper: Resolve relative URL against base URL
   */
  resolveUrl(href, base) {
    if (!href) return "";
    try {
      return new URL(href, base).href;
    } catch {
      return href;
    }
  }

  /**
   * Helper: Check if page HTML looks like an empty client-rendered JS shell
   */
  isClientRenderedShell(html) {
    if (!html || html.length < 500) return true;
    const lower = html.toLowerCase();
    const hasRoot =
      lower.includes('id="root"') ||
      lower.includes('id="__next"') ||
      lower.includes('id="app"');
    const strippedText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    // If has root tag and very little actual visible text (<200 chars), it's an unhydrated SPA
    return hasRoot && strippedText.length < 300;
  }

  /**
   * Batch scraping coordinator for all active studios
   * @param {object} [filter={}] - Query filter for studios
   * @param {object} [options={}] - Concurrency and options
   */
  async scrapeAllStudios(filter = {}, options = {}) {
    const { concurrency = 3, forceAiDiscovery = false } = options;

    const studios = await Studio.find({ isActive: true, ...filter });
    logger.info(`Starting batch scrape for ${studios.length} studios (concurrency: ${concurrency})`);

    const results = [];
    let processed = 0;

    for (let i = 0; i < studios.length; i += concurrency) {
      const chunk = studios.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map((s) => this.scrapeStudio(s, { forceAiDiscovery }))
      );

      results.push(...chunkResults);
      processed += chunk.length;

      logger.info(`Batch progress: ${processed}/${studios.length} studios processed`);
      // Brief breathing pause between chunks
      await new Promise((r) => setTimeout(r, 500));
    }

    const totalSaved = results.reduce((acc, r) => acc + (r.stats?.savedToDb || 0), 0);
    const successful = results.filter((r) => r.success).length;

    return {
      success: true,
      totalStudios: studios.length,
      successful,
      failed: studios.length - successful,
      totalJobsSaved: totalSaved,
      results,
    };
  }
}

export const scraperEngine = new ScraperEngine();
export default scraperEngine;
