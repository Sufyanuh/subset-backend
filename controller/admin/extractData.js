import axios from "axios";
import * as cheerio from "cheerio";
import { removeDuplicatesByUrl } from "../../utils/removeDulicateUrls.js";

export const extractData = async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ message: "URL is required." });
  }

  try {
    // ✅ Direct image or video extensions
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
      url.toLowerCase().includes(ext)
    );
    const isDirectVideo = videoExtensions.some((ext) =>
      url.toLowerCase().includes(ext)
    );

    // 🟢 Handle direct IMAGE URLs
    if (isDirectImage) {
      try {
        const response = await axios.head(url);
        const contentType = response.headers["content-type"];

        if (contentType?.startsWith("image/")) {
          const filename = url.split("/").pop().split("?")[0];
          return res.status(200).json({
            title: filename,
            images: [{ url, type: "image" }],
            isDirect: true,
          });
        }
      } catch {
        // fallback to GET
        try {
          const response = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 5000,
          });
          const contentType = response.headers["content-type"];
          if (contentType?.startsWith("image/")) {
            const filename = url.split("/").pop().split("?")[0];
            return res.status(200).json({
              title: filename,
              images: [{ url, type: "image" }],
              isDirect: true,
            });
          }
        } catch {
          return res
            .status(400)
            .json({ message: "Invalid or inaccessible image URL." });
        }
      }
    }

    // 🟢 Handle direct VIDEO URLs
    if (isDirectVideo) {
      try {
        const response = await axios.head(url);
        const contentType = response.headers["content-type"];

        if (contentType?.startsWith("video/")) {
          const filename = url.split("/").pop().split("?")[0];
          return res.status(200).json({
            title: filename,
            images: [{ url, type: "video" }],
            isDirect: true,
          });
        }
      } catch {
        // fallback to GET
        try {
          const response = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 5000,
          });
          const contentType = response.headers["content-type"];
          if (contentType?.startsWith("video/")) {
            const filename = url.split("/").pop().split("?")[0];
            return res.status(200).json({
              title: filename,
              images: [{ url, type: "video" }],
              isDirect: true,
            });
          }
        } catch {
          return res
            .status(400)
            .json({ message: "Invalid or inaccessible video URL." });
        }
      }
    }

    // 🟣 Otherwise: handle regular webpage (same as before)
    const response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html);

    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text() ||
      null;

    const imageUrls = [];
    const videoUrls = [];

    // ✅ <img> tags
    $("img").each((_, img) => {
      const src =
        $(img).attr("src") ||
        $(img).attr("data-src") ||
        $(img).attr("data-lazy") ||
        $(img).attr("data-original");
      if (src) {
        const absoluteUrl = new URL(src, url).href;
        imageUrls.push({ url: absoluteUrl, type: "image" });
      }
    });

    // ✅ <video> and <source> tags
    $("video, source").each((_, el) => {
      const src = $(el).attr("src");
      if (src) {
        const absoluteUrl = new URL(src, url).href;
        videoUrls.push({ url: absoluteUrl, type: "video" });
      }
    });

    // ✅ og:image & og:video
    const ogImage = $('meta[property="og:image"]').attr("content");
    const ogVideo = $('meta[property="og:video"]').attr("content");
    if (ogImage)
      imageUrls.push({ url: new URL(ogImage, url).href, type: "image" });
    if (ogVideo)
      videoUrls.push({ url: new URL(ogVideo, url).href, type: "video" });

    // ✅ Twitter player
    const twitterPlayer = $('meta[name="twitter:player"]').attr("content");
    if (twitterPlayer) {
      try {
        videoUrls.push({
          url: new URL(twitterPlayer, url).href,
          type: "video",
        });
      } catch {}
    }

    // ✅ Direct <a> video file links
    $(
      'a[href$=".mp4"], a[href$=".webm"], a[href$=".mov"], a[href$=".m3u8"]'
    ).each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        try {
          const absoluteUrl = new URL(href, url).href;
          videoUrls.push({ url: absoluteUrl, type: "video" });
        } catch {}
      }
    });

    // ✅ Raw video links in text (regex)
    const rawVideoRegex = /https?:\/\/[^\s'"<>]+?\.(mp4|webm|mov|m3u8)/gi;
    const matches = html.match(rawVideoRegex);
    if (matches) {
      matches.forEach((link) => videoUrls.push({ url: link, type: "video" }));
    }

    const allFiles = removeDuplicatesByUrl([...imageUrls, ...videoUrls]);

    res.status(200).json({
      title,
      images: allFiles,
    });
  } catch (error) {
    console.error("Failed to extract data:", error.message);
    res.status(500).json({ message: error.message, error });
  }
};
