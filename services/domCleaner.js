import * as cheerio from "cheerio";

/**
 * Cheerio-based DOM Cleaner utility
 * Strips non-content, visual, and tracking elements from raw HTML,
 * returning a lean, token-efficient DOM representation for LLMs.
 */
class DomCleaner {
  constructor() {
    this.tagsToRemove = [
      "script",
      "style",
      "svg",
      "img",
      "video",
      "audio",
      "source",
      "canvas",
      "iframe",
      "noscript",
      "nav",
      "footer",
      "header",
      "symbol",
      "path",
      "defs",
      "meta",
      "link",
      "picture",
      "object",
      "embed",
      "param",
    ];

    this.attributesToKeep = new Set([
      "class",
      "id",
      "role",
      "href",
      "data-id",
      "data-job-id",
      "data-department",
      "data-category",
      "aria-label",
      "name",
      "title",
    ]);
  }

  /**
   * Main clean method
   * @param {string} rawHtml - Full raw HTML string from target webpage
   * @param {object} options - Configuration options
   * @returns {string} Cleaned, trimmed HTML string
   */
  cleanHtml(rawHtml, options = {}) {
    if (!rawHtml || typeof rawHtml !== "string") {
      return "";
    }

    const {
      maxLength = 60000, // Maximum string length for AI context (~15k tokens)
      preferMainTag = true,
      preserveStructure = true,
    } = options;

    const $ = cheerio.load(rawHtml);

    // 1. Remove unwanted tags entirely
    $(this.tagsToRemove.join(", ")).remove();

    // 2. Remove HTML comments
    $("*")
      .contents()
      .filter((_, node) => node.type === "comment")
      .remove();

    // 3. Remove non-structural / non-content elements like cookie banners or dialogs
    $('[id*="cookie" i], [class*="cookie" i], [id*="banner" i], [class*="banner" i]').remove();
    $('[class*="newsletter" i], [id*="newsletter" i], [class*="popup" i], [id*="popup" i]').remove();

    // 4. Strip unneeded attributes across all elements to save token weight
    $("*").each((_, element) => {
      const attribs = element.attribs || {};
      for (const attrName of Object.keys(attribs)) {
        if (!this.attributesToKeep.has(attrName)) {
          delete attribs[attrName];
        } else if (attrName === "href") {
          // Normalize javascript: links or truncate gigantic URLs
          const val = attribs[attrName];
          if (val.startsWith("data:") || val.startsWith("javascript:")) {
            delete attribs[attrName];
          } else if (val.length > 200) {
            attribs[attrName] = val.slice(0, 200);
          }
        } else if (attrName === "class" && attribs[attrName]?.length > 120) {
          // Truncate insane Tailwind/utility class strings
          attribs[attrName] = attribs[attrName].slice(0, 120);
        }
      }
    });

    // 5. Select root context (main tag if available and non-empty, otherwise body)
    let root = $("body");
    if (preferMainTag && $("main").length > 0) {
      const mainText = $("main").text().trim();
      if (mainText.length > 100) {
        root = $("main");
      }
    }

    // 6. If body is missing, fallback to whole document
    if (root.length === 0) {
      root = $.root();
    }

    // 7. Remove empty or whitespace-only elements except semantic layout tags
    const emptyCandidates = root.find("div, span, p, section, li, ul");
    emptyCandidates.each((_, el) => {
      const $el = $(el);
      if ($el.children().length === 0 && !$el.text().trim() && !$el.attr("href")) {
        $el.remove();
      }
    });

    // 8. Extract HTML
    let cleaned = root.html() || "";

    // 9. Collapse multiple whitespaces and consecutive newlines
    cleaned = cleaned
      .replace(/\s{2,}/g, " ")
      .replace(/>\s+</g, "><")
      .trim();

    // 10. Intelligent truncation if length exceeds budget
    if (cleaned.length > maxLength) {
      // Find candidate job sections first
      const candidateSection = this.findCandidateJobSection($, root);
      if (candidateSection && candidateSection.length > 200 && candidateSection.length < maxLength * 1.5) {
        return candidateSection;
      }
      return cleaned.slice(0, maxLength);
    }

    return cleaned;
  }

  /**
   * Search for the specific DOM subtree most likely to contain job listings
   * @param {object} $ - Cheerio instance
   * @param {object} root - Current root cheerio selection
   * @returns {string|null} HTML of candidate section
   */
  findCandidateJobSection($, root) {
    // 1. Direct container candidates (known job listings wrappers)
    const directContainers = [
      "mat-accordion",
      "search-job-cards",
      '[class*="search-results" i]',
      '[class*="job-results" i]',
      '[class*="job-list" i]',
      '[class*="jobs-list" i]',
      '[class*="openings-list" i]',
      '[class*="career-list" i]',
      '[class*="positions-list" i]',
      '[id*="search-results" i]',
      '[id*="job-results" i]',
      '[id*="jobs-list" i]',
      '[id*="job-list" i]',
      "#hits",
      ".ais-Hits",
      '[role="feed"]',
    ];

    for (const selector of directContainers) {
      const el = root.find(selector).first();
      if (el.length > 0) {
        // Ensure it's not a filter bar
        const isFilter = el.is('[class*="filter" i], [id*="filter" i], form, search-filter-bar');
        if (!isFilter) {
          const html = el.prop("outerHTML") || el.html() || "";
          if (html.length > 300) {
            return html;
          }
        }
      }
    }

    // 2. Look for repeated job card / item elements
    const cardSelectors = [
      "mat-expansion-panel",
      ".search-result-item",
      '[class*="job-card" i]',
      '[class*="job-item" i]',
      '[class*="job-row" i]',
      '[class*="position-card" i]',
      '[class*="opening-card" i]',
      '[class*="search-hit" i]',
      'article[class*="job" i]',
      'li[class*="job" i]',
    ];

    for (const selector of cardSelectors) {
      const cards = root.find(selector);
      if (cards.length >= 1) {
        // Find their common parent
        const parent = cards.first().parent();
        if (parent && parent.length > 0) {
          const isFilter = parent.is('[class*="filter" i], [id*="filter" i], form, search-filter-bar');
          if (!isFilter) {
            const html = parent.prop("outerHTML") || parent.html() || "";
            if (html.length > 300) {
              return html;
            }
          }
        }
      }
    }

    // 3. Fallback: Find links with /jobs/ or /careers/ and get their common container
    const jobLinks = root.find('a[href*="/job" i], a[href*="/career" i]');
    if (jobLinks.length >= 2) {
      let current = jobLinks.first().parent();
      while (current && current.length > 0 && current.find(jobLinks).length < 2 && !current.is("body, main")) {
        current = current.parent();
      }
      if (current && current.length > 0 && !current.is("body, main")) {
        const html = current.prop("outerHTML") || current.html() || "";
        if (html.length > 300) {
          return html;
        }
      }
    }

    return null;
  }
}

export const domCleaner = new DomCleaner();
export default domCleaner;
