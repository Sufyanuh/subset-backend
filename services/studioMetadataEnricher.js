import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "../utils/logger.js";

/**
 * Studio Metadata & Visual Assets Enricher
 * Extracts website logo, favicon, OpenGraph images, and company about text
 * so that all scraped jobs are richly decorated with visual assets.
 */
class StudioMetadataEnricher {
  constructor() {
    this.http = axios.create({
      timeout: 8000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  }

  /**
   * Scrapes website for logo, favicon, og:image, and company description
   * @param {string} websiteUrl - Root studio website URL
   * @returns {Promise<object>} Extracted metadata & visual assets
   */
  async enrichStudioMetadata(websiteUrl) {
    if (!websiteUrl) return {};

    try {
      let target = websiteUrl.trim();
      if (!target.startsWith("http://") && !target.startsWith("https://")) {
        target = `https://${target}`;
      }

      const response = await this.http.get(target);
      const html = typeof response.data === "string" ? response.data : "";
      if (!html) return {};

      const $ = cheerio.load(html);
      const origin = new URL(target).origin;

      const visualAssets = [];
      let logo = "";
      let favicon = "";

      // 1. Favicon / Apple Touch Icon
      const appleIcon = $('link[rel="apple-touch-icon"]').attr("href");
      const icon =
        $('link[rel="icon"]').attr("href") ||
        $('link[rel="shortcut icon"]').attr("href");

      if (icon) {
        favicon = this.resolveUrl(icon, origin);
        visualAssets.push(favicon);
      } else {
        // Fallback default favicon
        favicon = `${origin}/favicon.ico`;
        visualAssets.push(favicon);
      }

      if (appleIcon) {
        visualAssets.push(this.resolveUrl(appleIcon, origin));
      }

      // 2. OpenGraph / Twitter Cards Images (Hero / Social Logo)
      const ogImage =
        $('meta[property="og:image"]').attr("content") ||
        $('meta[name="twitter:image"]').attr("content") ||
        $('meta[property="og:image:url"]').attr("content");

      if (ogImage) {
        const resolvedOg = this.resolveUrl(ogImage, origin);
        visualAssets.push(resolvedOg);
        if (!logo) logo = resolvedOg;
      }

      // 3. Logo Images from Header / Nav
      const logoImg =
        $('img[class*="logo" i]').attr("src") ||
        $('img[id*="logo" i]').attr("src") ||
        $('img[alt*="logo" i]').attr("src") ||
        $('a[class*="logo" i] img').attr("src");

      if (logoImg) {
        logo = this.resolveUrl(logoImg, origin);
        visualAssets.unshift(logo); // put primary logo at the front
      }

      // 4. About Company / Meta Description
      const aboutCompany =
        $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        $('meta[name="twitter:description"]').attr("content") ||
        "";

      // 5. Social Links (Instagram, LinkedIn)
      let instagram = "";
      let linkedin = "";

      $('a[href*="instagram.com"]').each((_, el) => {
        const href = $(el).attr("href");
        if (href && !instagram) instagram = href.split("?")[0];
      });

      $('a[href*="linkedin.com"]').each((_, el) => {
        const href = $(el).attr("href");
        if (href && !linkedin) linkedin = href.split("?")[0];
      });

      // Deduplicate visual assets
      const uniqueAssets = Array.from(new Set(visualAssets.filter(Boolean)));

      return {
        logo: logo || uniqueAssets[0] || "",
        favicon: favicon || "",
        visualAssets: uniqueAssets,
        aboutCompany: aboutCompany.trim(),
        instagram,
        linkedin,
      };
    } catch (error) {
      logger.warn(`Could not enrich metadata for ${websiteUrl}: ${error.message}`);
      return {};
    }
  }

  resolveUrl(href, base) {
    if (!href) return "";
    try {
      return new URL(href, base).href;
    } catch {
      return href;
    }
  }
}

export const studioMetadataEnricher = new StudioMetadataEnricher();
export default studioMetadataEnricher;
