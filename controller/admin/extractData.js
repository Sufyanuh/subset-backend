import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import { removeDuplicatesByUrl } from "../../utils/removeDulicateUrls.js";

export const extractData = async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ message: "URL is required." });
  }

  try {
    const imageExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".bmp",
      ".svg",
      ".ico",
    ];
    const videoExtensions = [".mp4", ".webm", ".mov", ".m3u8", ".avi", ".mkv"];

    const isDirectImage = imageExtensions.some((ext) =>
      url.toLowerCase().includes(ext),
    );
    const isDirectVideo = videoExtensions.some((ext) =>
      url.toLowerCase().includes(ext),
    );

    // 🟢 1. Handle Direct Image & Video URLs via Axios (Fast Path)
    if (isDirectImage || isDirectVideo) {
      const type = isDirectImage ? "image" : "video";
      try {
        const response = await axios.head(url);
        const contentType = response.headers["content-type"];
        if (contentType?.startsWith(`${type}/`)) {
          const filename = url.split("/").pop().split("?")[0];
          return res.status(200).json({
            title: filename,
            images: [{ url, type }],
            isDirect: true,
          });
        }
      } catch {
        // Fallback GET request if HEAD fails
        try {
          const response = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 5000,
          });
          const contentType = response.headers["content-type"];
          if (contentType?.startsWith(`${type}/`)) {
            const filename = url.split("/").pop().split("?")[0];
            return res.status(200).json({
              title: filename,
              images: [{ url, type }],
              isDirect: true,
            });
          }
        } catch {
          return res
            .status(400)
            .json({ message: `Invalid or inaccessible ${type} URL.` });
        }
      }
    }

    // 🟡 2. Handle Webpages (Server-side + Client-side via Puppeteer)
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled"
      ],
    });
    const page = await browser.newPage();

    // Mask headless presence to bypass bot detection (Unsplash, etc.)
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });
    });

    // Optimize page loading by blocking unnecessary resource heavy types (fonts, media) and trackers/analytics
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const urlStr = req.url().toLowerCase();
      const resourceType = req.resourceType();
      
      const isTrackerOrAd = 
        urlStr.includes("google-analytics") || 
        urlStr.includes("doubleclick") || 
        urlStr.includes("facebook.net") || 
        urlStr.includes("fbcdn") ||
        urlStr.includes("hotjar") || 
        urlStr.includes("pixel") ||
        urlStr.includes("analytics.js") ||
        urlStr.includes("gtag");

      if (["font", "media"].includes(resourceType) || isTrackerOrAd) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navigate with a fast timeout (15s) and catch timeouts to still parse the loaded DOM content
    try {
      await page.goto(url, { waitUntil: "load", timeout: 15000 });
    } catch (gotoError) {
      console.warn(`[SCRAPER WARNING] Navigation timeout or error on ${url}: ${gotoError.message}. Proceeding to extract DOM assets...`);
    }

    // Optional: Auto-scroll down the page to trigger lazy-loaded client content/images
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 500;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight || totalHeight > 10000) {
            // Limit max scroll depth
            clearInterval(timer);
            resolve();
          }
        }, 200);
      });
    });

    // Extract title & metadata from browser page context
    const pageData = await page.evaluate((baseUrl) => {
      const title =
        document.querySelector('meta[property="og:title"]')?.content ||
        document.querySelector("title")?.innerText ||
        null;

      const items = [];

      // Helper to push absolute URLs safely
      const addUrl = (relativeOrAbsolute, type) => {
        if (!relativeOrAbsolute) return;
        try {
          const absoluteUrl = new URL(relativeOrAbsolute, baseUrl).href;
          items.push({ url: absoluteUrl, type });
        } catch {}
      };

      // 1. Meta Tags (og, twitter)
      addUrl(
        document.querySelector('meta[property="og:image"]')?.content,
        "image",
      );
      addUrl(
        document.querySelector('meta[property="og:video"]')?.content,
        "video",
      );
      addUrl(
        document.querySelector('meta[name="twitter:player"]')?.content,
        "video",
      );

      // 2. Standard <img> tags, data attributes, and srcset variants
      document.querySelectorAll("img").forEach((img) => {
        const src =
          img.src ||
          img.getAttribute("data-src") ||
          img.getAttribute("data-lazy") ||
          img.getAttribute("data-original");
        addUrl(src, "image");

        // Parse srcset strings (e.g., "img-small.jpg 300w, img-large.jpg 1024w")
        const srcset = img.getAttribute("srcset");
        if (srcset) {
          srcset.split(",").forEach((srcsetItem) => {
            const parts = srcsetItem.trim().split(" ");
            if (parts[0]) addUrl(parts[0], "image");
          });
        }
      });

      // 3. Picture sources
      document.querySelectorAll("picture source").forEach((source) => {
        const srcset = source.getAttribute("srcset");
        if (srcset) {
          srcset.split(",").forEach((srcsetItem) => {
            const parts = srcsetItem.trim().split(" ");
            if (parts[0]) addUrl(parts[0], "image");
          });
        }
      });

      // 4. Video & Source elements
      document.querySelectorAll("video, source, a").forEach((el) => {
        const src = el.src || el.getAttribute("href");
        if (src) {
          if (/\.(mp4|webm|mov|m3u8|avi|mkv)(\?.*)?$/i.test(src)) {
            addUrl(src, "video");
          } else if (
            /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico)(\?.*)?$/i.test(src)
          ) {
            addUrl(src, "image");
          }
        }
      });

      // 5. Client-Side CSS Inline Background Images across all elements
      document.querySelectorAll("*").forEach((el) => {
        const bgImage = window.getComputedStyle(el).backgroundImage;
        if (bgImage && bgImage !== "none") {
          // Extract URLs from CSS format: url("...") or url('...')
          const matches = bgImage.match(/url\(['"]?(.*?)['"]?\)/g);
          if (matches) {
            matches.forEach((match) => {
              const urlMatch = match.match(/url\(['"]?(.*?)['"]?\)/);
              if (urlMatch && urlMatch[1]) {
                addUrl(urlMatch[1], "image");
              }
            });
          }
        }
      });

      return { title, items };
    }, url);

    await browser.close();

    const allFiles = removeDuplicatesByUrl(pageData.items);

    return res.status(200).json({
      title: pageData.title,
      images: allFiles,
    });
  } catch (error) {
    console.error("Failed to extract data:", error.message);
    return res.status(500).json({ message: error.message, error: error.stack });
  }
};
