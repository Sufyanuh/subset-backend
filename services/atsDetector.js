import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "../utils/logger.js";

/**
 * ATS Detector & Public API Connector
 * Detects whether a career URL or page embeds a known ATS (Greenhouse, Lever, Ashby)
 * and retrieves structured jobs directly from their public REST APIs with zero AI cost.
 */
class AtsDetector {
  constructor() {
    this.http = axios.create({
      timeout: 12000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json, text/html, */*",
      },
    });
  }

  /**
   * Detect ATS type and identifier from URL and optional HTML content
   * @param {string} url - Career page URL
   * @param {string} [html=""] - Optional pre-fetched HTML to check for embedded widgets/iframes
   * @returns {{ atsType: string, atsIdentifier: string }}
   */
  detectAts(url, html = "") {
    if (!url || typeof url !== "string") {
      return { atsType: "unknown", atsIdentifier: "" };
    }

    const cleanUrl = url.trim().toLowerCase();

    // 1. Check URL patterns directly
    // ----------------------------------------------------
    // Greenhouse: boards.greenhouse.io/{board} or job-boards.greenhouse.io/{board}
    const ghUrlMatch = cleanUrl.match(
      /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#]+)/i
    );
    if (ghUrlMatch && ghUrlMatch[1]) {
      return { atsType: "greenhouse", atsIdentifier: ghUrlMatch[1] };
    }

    // Lever: jobs.lever.co/{site}
    const leverUrlMatch = cleanUrl.match(/jobs\.lever\.co\/([^/?#]+)/i);
    if (leverUrlMatch && leverUrlMatch[1]) {
      return { atsType: "lever", atsIdentifier: leverUrlMatch[1] };
    }

    // Ashby: jobs.ashbyhq.com/{board}
    const ashbyUrlMatch = cleanUrl.match(/jobs\.ashbyhq\.com\/([^/?#]+)/i);
    if (ashbyUrlMatch && ashbyUrlMatch[1]) {
      return { atsType: "ashby", atsIdentifier: ashbyUrlMatch[1] };
    }

    // 2. Check HTML content for embedded iframes or scripts
    // ----------------------------------------------------
    if (html && typeof html === "string") {
      // Greenhouse iframe or script embed
      const ghEmbedMatch =
        html.match(/boards\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-zA-Z0-9_-]+)/i) ||
        html.match(/for=["']([a-zA-Z0-9_-]+)["'][^>]*src=["'][^"']*greenhouse/i) ||
        html.match(/src=["'][^"']*greenhouse\.io[^"']*for=([a-zA-Z0-9_-]+)/i);
      if (ghEmbedMatch && ghEmbedMatch[1]) {
        return { atsType: "greenhouse", atsIdentifier: ghEmbedMatch[1] };
      }

      // Lever embed
      const leverEmbedMatch =
        html.match(/jobs\.lever\.co\/([a-zA-Z0-9_-]+)/i) ||
        html.match(/data-lever-site=["']([a-zA-Z0-9_-]+)["']/i);
      if (leverEmbedMatch && leverEmbedMatch[1]) {
        return { atsType: "lever", atsIdentifier: leverEmbedMatch[1] };
      }

      // Ashby embed
      const ashbyEmbedMatch =
        html.match(/jobs\.ashbyhq\.com\/([a-zA-Z0-9_-]+)/i) ||
        html.match(/ashbyhq\.com\/posting-api\/job-board\/([a-zA-Z0-9_-]+)/i);
      if (ashbyEmbedMatch && ashbyEmbedMatch[1]) {
        return { atsType: "ashby", atsIdentifier: ashbyEmbedMatch[1] };
      }
    }

    return { atsType: "custom", atsIdentifier: "" };
  }

  /**
   * Fetch standardized job listings from public ATS API
   * @param {string} atsType - 'greenhouse' | 'lever' | 'ashby'
   * @param {string} atsIdentifier - Token / site name for the ATS
   * @param {object} studio - Studio metadata
   * @returns {Promise<Array<object>>} Standardized jobs
   */
  async fetchAtsJobs(atsType, atsIdentifier, studio = {}) {
    if (!atsIdentifier) {
      return [];
    }

    switch (atsType) {
      case "greenhouse":
        return this.fetchGreenhouseJobs(atsIdentifier, studio);
      case "lever":
        return this.fetchLeverJobs(atsIdentifier, studio);
      case "ashby":
        return this.fetchAshbyJobs(atsIdentifier, studio);
      default:
        return [];
    }
  }

  /**
   * Greenhouse Public Board API
   * Docs: https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
   */
  async fetchGreenhouseJobs(boardToken, studio = {}) {
    try {
      const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
        boardToken
      )}/jobs?content=true`;
      const response = await this.http.get(apiUrl);
      const data = response.data;
      const jobs = data.jobs || [];

      return jobs.map((item) => {
        const department =
          item.departments && item.departments.length > 0 ? item.departments[0].name : "";
        const location = item.location?.name || "";
        const workplaceType = this.inferWorkplaceType(location, item.title);
        const postedDateRaw = item.updated_at || item.created_at || null;
        const postedAt = postedDateRaw ? new Date(postedDateRaw) : null;

        return {
          jobTitle: item.title?.trim() || "Open Role",
          companyName: studio.name || boardToken,
          website: studio.website || studio.careersUrl || "",
          applicationLink: item.absolute_url || "",
          location,
          workplaceType,
          contractType: "Full-time",
          department,
          overview: this.cleanOverview(item.content || ""),
          postedAt: postedAt && !isNaN(postedAt.getTime()) ? postedAt : null,
          source: "greenhouse",
          sourceId: String(item.id || ""),
        };
      });
    } catch (error) {
      logger.error(`Failed to fetch Greenhouse jobs for board: ${boardToken}`, error);
      return [];
    }
  }

  /**
   * Lever Public Postings API
   * Docs: https://api.lever.co/v0/postings/{site}?mode=json
   */
  async fetchLeverJobs(siteName, studio = {}) {
    try {
      const apiUrl = `https://api.lever.co/v0/postings/${encodeURIComponent(siteName)}?mode=json`;
      const response = await this.http.get(apiUrl);
      const jobs = Array.isArray(response.data) ? response.data : [];

      return jobs.map((item) => {
        const location = item.categories?.location || "";
        const workplaceType =
          item.categories?.workplaceType || this.inferWorkplaceType(location, item.text);
        const department = item.categories?.department || item.categories?.team || "";
        const postedDateRaw = item.createdAt || item.updatedAt || null;
        const postedAt = postedDateRaw ? new Date(postedDateRaw) : null;

        return {
          jobTitle: item.text?.trim() || "Open Role",
          companyName: studio.name || siteName,
          website: studio.website || studio.careersUrl || "",
          applicationLink: item.applyUrl || item.hostedUrl || "",
          location,
          workplaceType: this.normalizeWorkplaceType(workplaceType),
          contractType: this.normalizeContractType(item.categories?.commitment),
          department,
          salaryRange: item.salaryDescription || "",
          overview: this.cleanOverview(item.description || item.descriptionPlain || ""),
          postedAt: postedAt && !isNaN(postedAt.getTime()) ? postedAt : null,
          source: "lever",
          sourceId: String(item.id || ""),
        };
      });
    } catch (error) {
      logger.error(`Failed to fetch Lever jobs for site: ${siteName}`, error);
      return [];
    }
  }

  /**
   * Ashby Public Postings API
   * Docs: https://api.ashbyhq.com/posting-api/job-board/{jobBoardName}
   */
  async fetchAshbyJobs(jobBoardName, studio = {}) {
    try {
      const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
        jobBoardName
      )}`;
      const response = await this.http.get(apiUrl);
      const data = response.data || {};
      const jobs = data.jobs || [];

      return jobs.map((item) => {
        const location =
          item.location ||
          item.address?.postalAddress?.addressLocality ||
          item.secondaryLocations?.join(", ") ||
          "";
        const workplaceType = item.isRemote
          ? "Remote"
          : this.inferWorkplaceType(location, item.title);
        const postedDateRaw = item.publishedAt || item.createdAt || null;
        const postedAt = postedDateRaw ? new Date(postedDateRaw) : null;

        return {
          jobTitle: item.title?.trim() || "Open Role",
          companyName: studio.name || jobBoardName,
          website: studio.website || studio.careersUrl || "",
          applicationLink: item.jobUrl || item.applyUrl || "",
          location,
          workplaceType,
          contractType: this.normalizeContractType(item.employmentType),
          department: item.department || "",
          overview: this.cleanOverview(item.descriptionHtml || item.descriptionPlain || ""),
          postedAt: postedAt && !isNaN(postedAt.getTime()) ? postedAt : null,
          source: "ashby",
          sourceId: String(item.id || ""),
        };
      });
    } catch (error) {
      logger.error(`Failed to fetch Ashby jobs for board: ${jobBoardName}`, error);
      return [];
    }
  }

  /**
   * Helper: Clean and format overview text, decoding HTML entities,
   * preserving semantic tags for rich text editors, and converting plain text to paragraphs
   */
  cleanOverview(content) {
    if (!content) return "";
    let formatted = String(content).trim();

    // 1. Decode HTML entities if present (e.g. Greenhouse returns &lt;p&gt;...&lt;/p&gt;)
    if (/&lt;|&gt;|&quot;|&#39;|&amp;|&#x2F;|&#x27;/i.test(formatted)) {
      formatted = formatted
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ");
    }

    // 2. Repair corrupted / nested link hrefs if any
    formatted = formatted.replace(
      /<a\s+[^>]*?href=["'](?:&lt;|<)a\s+[^>]*?>([\s\S]*?)<\/a>/gi,
      (match, innerContent) => {
        const urlMatch = match.match(/https?:\/\/[^\s"'<>]+/i);
        if (!urlMatch) return innerContent;
        const url = urlMatch[0].replace(/["'>\\]+$/, "");
        let textContent = innerContent
          .replace(/https?:\/\/[^\s"'<>]+/gi, "")
          .replace(/(?:target|rel|href)=["']?[^"'\s>]*["']?/gi, "")
          .replace(/&[a-z]+;|[<>"';\\:=]+/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
        const words = textContent.split(" ").filter(Boolean);
        if (words.length > 1 && words.every((w) => w.toLowerCase() === words[0].toLowerCase())) {
          textContent = words[0];
        }
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${textContent || url}</a>`;
      }
    );
    formatted = formatted.replace(/href=["']\[?(https?:\/\/[^"'>\s\]]+)\]?["']/gi, 'href="$1"');

    // 3. Strip <br> tags directly inside lists (ul/ol) or between/around li tags
    formatted = formatted
      .replace(/(<(?:ul|ol)[^>]*>)(?:\s*<br\s*\/?>)+/gi, "$1")
      .replace(/(?:\s*<br\s*\/?>)+(\s*<\/(?:ul|ol)>)/gi, "$1")
      .replace(/(<\/li>)(?:\s*<br\s*\/?>)+(\s*<li[^>]*>)/gi, "$1$2")
      .replace(/(<\/li>)(?:\s*<br\s*\/?>)+(\s*<\/(?:ul|ol)>)/gi, "$1$2")
      .replace(/(<li[^>]*>)(?:\s*<br\s*\/?>)+/gi, "$1")
      .replace(/(?:\s*<br\s*\/?>)+(\s*<\/li>)/gi, "$1");

    // 4. Remove empty <li> and empty lists
    let prevList;
    do {
      prevList = formatted;
      formatted = formatted.replace(/<li[^>]*>(?:\s|&nbsp;|<br\s*\/?>|\u00A0|\u200B)*<\/li>/gi, "");
    } while (formatted !== prevList);

    do {
      prevList = formatted;
      formatted = formatted.replace(/<(ul|ol)[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi, "");
    } while (formatted !== prevList);

    // 5. Check if content is HTML
    const hasHtmlTags = /<(?:p|br|div|ul|ol|li|h[1-6]|table|strong|em|span|b|i|a)[\s>]/i.test(formatted);

    if (hasHtmlTags) {
      try {
        const $ = cheerio.load(formatted, null, false);

        // Remove dangerous/unwanted tags
        $("script, style, iframe, form, input, button").remove();

        // Remove any <br> tags directly inside <ul>, <ol>, <table>, etc.
        $("ul > br, ol > br, dl > br, table > br, tbody > br, tr > br").remove();

        // Clean up <li> elements: remove empty ones and leading/trailing <br>
        $("li").each((_, el) => {
          const $li = $(el);
          $li.children("br:first-child, br:last-child").remove();
          const text = $li.text().replace(/[\s\u00A0\u200B]+/g, "").trim();
          const hasMedia = $li.find("img, svg, video, iframe, a").length > 0;
          if (!text && !hasMedia) {
            $li.remove();
          }
        });

        // Remove empty <ul> or <ol>
        $("ul, ol").each((_, el) => {
          const $list = $(el);
          if ($list.children("li").length === 0 && !$list.text().trim()) {
            $list.remove();
          }
        });

        // Clean link href attributes (fix any corrupted or unescaped brackets)
        $("a").each((_, el) => {
          let href = $(el).attr("href") || "";
          href = href.replace(/^\[|\"$|\'$/g, "").trim();
          if (href.startsWith("http://") || href.startsWith("https://")) {
            $(el).attr("href", href);
            $(el).attr("target", "_blank");
            $(el).attr("rel", "noopener noreferrer");
          }
        });

        // Clean up redundant empty paragraphs
        let htmlOutput = $.html().trim();
        htmlOutput = htmlOutput
          .replace(/<ul([^>]*)>(\s*<br\s*\/?>)+/gi, "<ul$1>")
          .replace(/(\s*<br\s*\/?>)+<\/ul>/gi, "</ul>")
          .replace(/<ol([^>]*)>(\s*<br\s*\/?>)+/gi, "<ol$1>")
          .replace(/(\s*<br\s*\/?>)+<\/ol>/gi, "</ol>")
          .replace(/<\/li>(\s*<br\s*\/?>)+<li>/gi, "</li><li>")
          .replace(/<li>(\s*<br\s*\/?>)+/gi, "<li>")
          .replace(/(\s*<br\s*\/?>)+<\/li>/gi, "</li>")
          .replace(/(?:<p[^>]*>\s*(?:<br\s*\/?>|\s*)*<\/p>\s*){2,}/gi, "<p><br/></p>");

        return htmlOutput;
      } catch (err) {
        logger.warn(`Cheerio HTML sanitization warning: ${err.message}`);
        return formatted;
      }
    }

    // 6. Plain text: Remove empty bullet points (e.g. • or - alone on a line)
    formatted = formatted.replace(/^[-*•]\s*$/gm, "");

    // 3. Plain text: Auto-linkify raw URLs and convert line breaks to <p>
    const urlRegex = /(?![^<]*>|[^<>]*<\/a>)((?:https?:\/\/|www\.)[^\s<]+[^<.,:;"')\]\s])/gi;
    formatted = formatted.replace(urlRegex, (matched) => {
      const href = matched.startsWith("http") ? matched : `https://${matched}`;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${matched}</a>`;
    });

    const paragraphs = formatted
      .split(/\r?\n\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (paragraphs.length > 1) {
      return paragraphs
        .map((p) => `<p>${p.replace(/\r?\n/g, "<br/>")}</p>`)
        .join("");
    }
    return formatted.replace(/\r?\n/g, "<br/>");
  }

  /**
   * Helper: Strip HTML tags to get clean plain overview text
   */
  stripHtml(html) {
    if (!html) return "";
    try {
      const $ = cheerio.load(html);
      return $.text().replace(/\s+/g, " ").trim();
    } catch {
      return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  /**
   * Helper: Infer workplace type from strings
   */
  inferWorkplaceType(location = "", title = "") {
    const combined = `${location} ${title}`.toLowerCase();
    if (combined.includes("remote") || combined.includes("anywhere") || combined.includes("wfh")) {
      return "Remote";
    }
    if (combined.includes("hybrid")) {
      return "Hybrid";
    }
    return "On-site";
  }

  normalizeWorkplaceType(val) {
    if (!val) return "On-site";
    const lower = String(val).toLowerCase();
    if (lower.includes("remote")) return "Remote";
    if (lower.includes("hybrid")) return "Hybrid";
    return "On-site";
  }

  normalizeContractType(val) {
    if (!val) return "Full-time";
    const lower = String(val).toLowerCase();
    if (lower.includes("part")) return "Part-time";
    if (lower.includes("contract")) return "Contract";
    if (lower.includes("freelance")) return "Freelance";
    if (lower.includes("intern")) return "Internship";
    return "Full-time";
  }
}

export const atsDetector = new AtsDetector();
export default atsDetector;
