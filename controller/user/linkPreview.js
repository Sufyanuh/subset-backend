import axios from "axios";
import * as cheerio from "cheerio";
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

// ✅ oEmbed providers
const oEmbedProviders = {
  youtube: (url) =>
    `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
  instagram: (url) =>
    `https://graph.facebook.com/v17.0/instagram_oembed?url=${encodeURIComponent(
      url
    )}&omitscript=true`,
  twitter: (url) =>
    `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`,
  tiktok: (url) =>
    `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
  facebook: (url) =>
    `https://graph.facebook.com/v17.0/oembed_post?url=${encodeURIComponent(
      url
    )}`,
};

// ✅ Normalize and clean up incoming URLs
const normalizeUrl = (inputUrl) => {
  try {
    let url = inputUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    // Replace mobile YouTube domain
    url = url.replace("m.youtube.com", "www.youtube.com");

    // Convert short YouTube links to full form
    const shortYouTubeRegex =
      /^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]+)(?:\?.*)?$/;
    const match = url.match(shortYouTubeRegex);
    if (match) url = `https://www.youtube.com/watch?v=${match[1]}`;

    return url;
  } catch {
    return inputUrl;
  }
};

export const getLinkPreview = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res
        .status(400)
        .json({ success: false, message: "Missing URL query parameter (q)" });
    }

    const url = normalizeUrl(q);
    const cached = cache.get(url);
    if (cached) return res.json({ success: true, ...cached, cached: true });

    const hostname = new URL(url).hostname;
    let previewData = null;

    // ✅ Try oEmbed providers first
    const provider = Object.keys(oEmbedProviders).find((key) =>
      hostname.includes(key)
    );
    if (provider) {
      try {
        const oembedUrl = oEmbedProviders[provider](url);
        const { data } = await axios.get(oembedUrl, { timeout: 8000 });

        previewData = {
          title: data.title || data.author_name || provider,
          description: data.author_name
            ? `View on ${data.author_name}'s ${provider} page`
            : "",
          image: data.thumbnail_url || null,
          site: hostname.replace(/^www\./, ""),
          favicon: `https://www.google.com/s2/favicons?sz=64&domain_url=${hostname}`,
          url,
        };
      } catch (e) {
        console.warn(`⚠️ ${provider} oEmbed failed:`, e.message);
      }
    }

    // ✅ Fallback to manual scraping if oEmbed fails
    if (!previewData) {
      const response = await axios.get(url, {
        timeout: 8000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        },
      });

      const html = response.data;
      const $ = cheerio.load(html);

      const getMeta = (name) =>
        $(`meta[property="${name}"]`).attr("content") ||
        $(`meta[name="${name}"]`).attr("content") ||
        $(`meta[itemprop="${name}"]`).attr("content");

      const title = getMeta("og:title") || $("title").first().text();
      const description = getMeta("og:description") || getMeta("description");
      const image =
        getMeta("og:image") ||
        getMeta("twitter:image") ||
        $("img").first().attr("src") ||
        null;
      const favicon =
        $('link[rel="icon"]').attr("href") ||
        $('link[rel="shortcut icon"]').attr("href") ||
        `/favicon.ico`;

      previewData = {
        title: title || hostname,
        description: description || "",
        image: image ? new URL(image, url).href : null,
        site: hostname.replace(/^www\./, ""),
        favicon: favicon
          ? new URL(favicon, url).href
          : `https://www.google.com/s2/favicons?domain=${hostname}`,
        url,
      };
    }

    // ✅ Cache and return response
    cache.set(url, previewData);
    return res.json({ success: true, ...previewData });
  } catch (error) {
    console.error("❌ Link preview error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch link preview",
      error: error.message,
    });
  }
};
