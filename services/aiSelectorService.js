import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import * as cheerio from "cheerio";
import { domCleaner } from "./domCleaner.js";
import { logger } from "../utils/logger.js";

/**
 * AI Selector Discovery Service
 * Analyzes clean HTML using Google Gemini Flash (with OpenAI fallback)
 * to discover robust CSS selectors for job listings conforming to Job model fields.
 */
class AiSelectorService {
  _initClients() {
    const currentGeminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    const currentOpenaiKey = process.env.OPENAI_API_KEY || "";

    if (!this.gemini && currentGeminiKey) {
      this.geminiApiKey = currentGeminiKey;
      this.gemini = new GoogleGenAI({ apiKey: currentGeminiKey });
    }
    if (!this.openai && currentOpenaiKey) {
      this.openaiApiKey = currentOpenaiKey;
      this.openai = new OpenAI({ apiKey: currentOpenaiKey });
    }
  }

  isConfigured() {
    this._initClients();
    return Boolean(this.gemini || this.openai);
  }

  /**
   * Discover CSS selectors for a studio career page
   * @param {string} rawHtml - Webpage raw HTML
   * @param {object} context - Context info (studioName, url)
   * @returns {Promise<object>} Discovered selectors result
   */
  async discoverSelectors(rawHtml, context = {}) {
    const { studioName = "Studio", url = "" } = context;

    if (!rawHtml || typeof rawHtml !== "string") {
      return { success: false, error: "Empty or invalid HTML provided" };
    }

    if (!this.isConfigured()) {
      logger.warn("Neither GEMINI_API_KEY nor OPENAI_API_KEY configured for selector discovery");
      return {
        success: false,
        error: "AI selector service not configured (missing GEMINI_API_KEY or OPENAI_API_KEY)",
      };
    }

    // 1. Clean the DOM to minimize tokens
    const cleanedDom = domCleaner.cleanHtml(rawHtml, { maxLength: 55000 });

    if (!cleanedDom || cleanedDom.length < 50) {
      return {
        success: false,
        error: "Cleaned DOM is empty or too short. Page may require JavaScript/Puppeteer rendering.",
        requiresPuppeteer: true,
      };
    }

    // 2. Build prompt
    const prompt = this.buildPrompt({
      cleanedDom,
      studioName,
      url,
    });

    try {
      let rawResult = null;

      // 3. Attempt discovery via Gemini Flash (primary) with automatic OpenAI fallback
      if (this.gemini) {
        try {
          rawResult = await this.callGemini(prompt);
        } catch (geminiError) {
          logger.warn(
            `Gemini API discovery failed (${geminiError.message}). Falling back to OpenAI...`
          );
          if (this.openai) {
            rawResult = await this.callOpenAI(prompt);
          } else {
            throw geminiError;
          }
        }
      } else if (this.openai) {
        rawResult = await this.callOpenAI(prompt);
      }

      if (!rawResult) {
        return { success: false, error: "AI model returned empty response" };
      }

      const parsed = typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;

      if (!parsed.hasJobs || !parsed.jobContainer) {
        return {
          success: false,
          hasJobs: false,
          message: parsed.notes || "No active jobs detected in the page DOM",
          data: parsed,
        };
      }

      // 4. Validate selectors against original rawHtml with Cheerio
      const validation = this.validateSelectors(rawHtml, parsed);

      if (!validation.isValid) {
        logger.warn(`AI selectors validation failed for ${studioName} (${url})`, {
          selectors: parsed,
          issues: validation.issues,
        });

        return {
          success: false,
          error: `Selector validation failed: ${validation.issues.join(", ")}`,
          suggestedSelectors: parsed,
          validation,
        };
      }

      logger.info(`Successfully discovered selectors for ${studioName}`, {
        selectors: parsed,
        elementsFound: validation.matchCount,
      });

      return {
        success: true,
        selectors: {
          jobContainer: parsed.jobContainer,
          titleSelector: parsed.titleSelector || "",
          locationSelector: parsed.locationSelector || "",
          applyUrlSelector: parsed.applyUrlSelector || "",
          salarySelector: parsed.salarySelector || "",
          departmentSelector: parsed.departmentSelector || "",
          workplaceTypeSelector: parsed.workplaceTypeSelector || "",
          contractTypeSelector: parsed.contractTypeSelector || "",
          descriptionSelector: parsed.descriptionSelector || "",
          imageSelector: parsed.imageSelector || "",
          companyNameSelector: parsed.companyNameSelector || "",
        },
        sampleMatches: validation.samples,
        matchCount: validation.matchCount,
        confidenceScore: parsed.confidenceScore || 0.9,
      };
    } catch (error) {
      logger.error(`Error discovering AI selectors for ${studioName}`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Call Google Gemini Flash with structured schema
   */
  async callGemini(prompt) {
    const modelName = "gemini-2.5-flash";
    const response = await this.gemini.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            hasJobs: {
              type: "boolean",
              description: "True if active job openings exist in the HTML snippet",
            },
            jobContainer: {
              type: "string",
              description:
                "CSS selector for EACH individual job item/card/row (e.g. '.job-card', 'li.opening', 'tr.job-row')",
            },
            titleSelector: {
              type: "string",
              description:
                "CSS selector relative to jobContainer for the job title (e.g. 'h3', '.title', 'a.role-link')",
            },
            locationSelector: {
              type: "string",
              description:
                "CSS selector relative to jobContainer for location/city/country (e.g. '.location', 'span.meta-loc')",
            },
            applyUrlSelector: {
              type: "string",
              description:
                "CSS selector relative to jobContainer for apply/detail link (e.g. 'a', 'a.btn-apply'). If container itself is <a>, output ''",
            },
            salarySelector: {
              type: "string",
              description: "CSS selector relative to jobContainer for compensation/salary range, or '' if not present",
            },
            departmentSelector: {
              type: "string",
              description: "CSS selector relative to jobContainer for category/department, or '' if not present",
            },
            workplaceTypeSelector: {
              type: "string",
              description: "CSS selector relative to jobContainer for remote/hybrid/onsite badge, or '' if absent",
            },
            contractTypeSelector: {
              type: "string",
              description: "CSS selector relative to jobContainer for full-time/contract/internship, or '' if absent",
            },
            descriptionSelector: {
              type: "string",
              description: "CSS selector relative to jobContainer for brief description/overview snippet, or ''",
            },
            imageSelector: {
              type: "string",
              description: "CSS selector relative to jobContainer for job thumbnail/image (e.g. 'img.thumb', 'img'), or ''",
            },
            companyNameSelector: {
              type: "string",
              description: "CSS selector relative to jobContainer for company name if multi-studio board, or ''",
            },
            confidenceScore: {
              type: "number",
              description: "Confidence from 0.0 to 1.0",
            },
            notes: {
              type: "string",
              description: "Brief note explaining the structure found or why no jobs were found",
            },
          },
          required: ["hasJobs", "jobContainer", "titleSelector"],
        },
      },
    });

    const text = response.text;
    return text ? JSON.parse(text) : null;
  }

  /**
   * Fallback via OpenAI
   */
  async callOpenAI(prompt) {
    const completion = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert web scraping architect. Analyze cleaned HTML and return strictly valid CSS Selectors matching job schema as JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const content = completion.choices[0]?.message?.content;
    return content ? JSON.parse(content) : null;
  }

  /**
   * Construct the discovery prompt
   */
  buildPrompt({ cleanedDom, studioName, url }) {
    return `
Analyze the following cleaned HTML from the careers/jobs page of studio "${studioName}" (${url}).
Your goal is to extract valid, robust CSS selectors to scrape job listings using Cheerio into our Job model schema.

IMPORTANT REQUIREMENTS:
1. 'jobContainer' must match EACH single job listing element (e.g. each row, card, or list item). It should match MULTIPLE elements when multiple jobs exist. Do NOT select the outer wrapper/list itself.
2. All field selectors ('titleSelector', 'locationSelector', 'applyUrlSelector', 'salarySelector', 'departmentSelector', 'workplaceTypeSelector', 'contractTypeSelector', 'descriptionSelector', 'imageSelector') must be RELATIVE to 'jobContainer' (e.g., container.find(titleSelector)).
3. If 'jobContainer' itself is an <a> tag linking to the job, set 'applyUrlSelector' to "" (empty string).
4. If the job listing has a logo or image element (e.g. <img> or element with style/src), provide 'imageSelector'.
5. Prefer resilient, clean selectors (e.g. tag + class like 'li.job-listing', 'h3.title') rather than fragile dynamic hash classes or deeply nested pseudo-selectors.
6. If the page clearly has no job openings (e.g. says "No current openings", "Check back later", or empty careers section), set "hasJobs": false.

Cleaned HTML Snippet:
\`\`\`html
${cleanedDom}
\`\`\`
`.trim();
  }

  /**
   * Validate discovered selectors against raw HTML using Cheerio
   */
  validateSelectors(rawHtml, selectors) {
    const $ = cheerio.load(rawHtml);
    const issues = [];
    const samples = [];

    const { jobContainer, titleSelector, locationSelector, applyUrlSelector, imageSelector } = selectors;

    if (!jobContainer) {
      return { isValid: false, issues: ["jobContainer selector is missing"] };
    }

    let containers;
    try {
      containers = $(jobContainer);
    } catch (err) {
      return { isValid: false, issues: [`Invalid CSS selector for jobContainer: ${err.message}`] };
    }

    if (containers.length === 0) {
      issues.push(`jobContainer '${jobContainer}' matched 0 elements in HTML`);
      return { isValid: false, issues };
    }

    let validTitlesCount = 0;
    containers.slice(0, 5).each((_, el) => {
      const $el = $(el);

      let title = "";
      if (titleSelector) {
        try {
          title = $el.find(titleSelector).first().text().trim();
        } catch {
          title = "";
        }
      }
      if (!title) {
        title = $el.find("h1, h2, h3, h4, a, strong").first().text().trim();
      }

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

      let location = "";
      if (locationSelector) {
        try {
          location = $el.find(locationSelector).first().text().trim();
        } catch {
          location = "";
        }
      }

      let image = "";
      if (imageSelector) {
        try {
          image = $el.find(imageSelector).first().attr("src") || "";
        } catch {
          image = "";
        }
      }

      if (title) {
        validTitlesCount++;
        samples.push({ title, location, applyUrl, image });
      }
    });

    if (validTitlesCount === 0) {
      issues.push(`titleSelector '${titleSelector}' failed to extract any title text from matching containers`);
    }

    return {
      isValid: issues.length === 0,
      matchCount: containers.length,
      samples,
      issues,
    };
  }
}

export const aiSelectorService = new AiSelectorService();
export default aiSelectorService;
