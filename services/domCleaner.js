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
      if (candidateSection && candidateSection.length > 200 && candidateSection.length < maxLength) {
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
    const jobKeywords = [
      '[class*="job" i]',
      '[class*="career" i]',
      '[class*="opening" i]',
      '[class*="position" i]',
      '[id*="job" i]',
      '[id*="career" i]',
      '[id*="opening" i]',
      '[id*="position" i]',
      'ul[class*="list" i]',
      "table",
    ];

    for (const selector of jobKeywords) {
      const matches = root.find(selector);
      if (matches.length > 0) {
        // Find container that has multiple matching children (likely job cards)
        const parent = matches.first().parent();
        if (parent && parent.length > 0) {
          const html = parent.html();
          if (html && html.length > 300) {
            return parent.prop("outerHTML") || html;
          }
        }
      }
    }

    return null;
  }
}

export const domCleaner = new DomCleaner();
export default domCleaner;
