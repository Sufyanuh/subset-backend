import OpenAI from "openai";
import axios from "axios";
import path from "path";
import fs from "fs";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobePath from "ffprobe-static";
import NodeCache from "node-cache";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Categories } from "../../model/categories.js";
import {
  DEFAULT_DISCIPLINES,
  buildSystemPrompt,
  buildTaxonomyJsonSchema,
} from "../../config/taxonomyPrompts.js";

// ====================================================================
// 🔹 1. IN-MEMORY CACHE & SYSTEM CONFIGURATION
// ====================================================================
const analysisCache = new NodeCache({ stdTTL: 604800, checkperiod: 3600 }); // 7-day TTL

if (ffmpegInstaller && ffmpegInstaller.path) {
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
}
if (ffprobePath) {
  if (typeof ffprobePath === "string") {
    ffmpeg.setFfprobePath(ffprobePath);
  } else if (ffprobePath.path) {
    ffmpeg.setFfprobePath(ffprobePath.path);
  }
}

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);

// ====================================================================
// 🔹 2. DATABASE CATEGORIES FETCHING
// ====================================================================
/**
 * Queries MongoDB for active category names.
 * Falls back to DEFAULT_DISCIPLINES if database is unreachable or empty.
 */
export async function getDbCategoryNames() {
  try {
    const docs = await Categories.find({}, "name").lean();
    if (docs && docs.length > 0) {
      const names = docs
        .map((c) => (c.name ? String(c.name).replace(/\t/g, "").trim() : ""))
        .filter(Boolean);

      const uniqueNames = [];
      const seen = new Set();
      for (const n of names) {
        const lower = n.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          uniqueNames.push(n);
        }
      }

      if (uniqueNames.length > 0) {
        return uniqueNames;
      }
    }
  } catch (err) {
    console.warn(
      `[DB Categories] Failed to query MongoDB Categories collection:`,
      err.message
    );
  }
  return DEFAULT_DISCIPLINES;
}

// ====================================================================
// 🔹 3. DATA SANITIZATION & BACKWARD COMPATIBILITY
// ====================================================================
export function validateAndSanitizeAnalysis(data, dbCategoryNames = []) {
  if (!data || typeof data !== "object") {
    throw new Error("Analysis output is not a valid JSON object.");
  }

  const activeCategories =
    Array.isArray(dbCategoryNames) && dbCategoryNames.length > 0
      ? dbCategoryNames
      : DEFAULT_DISCIPLINES;

  const validCategoriesSet = new Set(
    activeCategories.map((c) => c.toLowerCase())
  );
  const canonicalMap = new Map(
    activeCategories.map((c) => [c.toLowerCase(), c])
  );

  // Extract disciplines
  const rawDisciplines = Array.isArray(data.disciplines)
    ? data.disciplines
    : Array.isArray(data.category)
    ? data.category
    : data.category
    ? [data.category]
    : [];

  const sanitizedDisciplines = [];
  for (const disc of rawDisciplines) {
    const lower = String(disc).trim().toLowerCase();
    if (validCategoriesSet.has(lower)) {
      const canonical = canonicalMap.get(lower);
      if (!sanitizedDisciplines.includes(canonical)) {
        sanitizedDisciplines.push(canonical);
      }
    }
  }

  // Fallback discipline if none matched
  if (sanitizedDisciplines.length === 0) {
    sanitizedDisciplines.push(activeCategories[0] || "Art Direction");
  }

  // Extract visual tags (max 10 tags)
  const rawTags = Array.isArray(data.visual_tags)
    ? data.visual_tags
    : Array.isArray(data.tags)
    ? data.tags
    : [];

  const sanitizedVisualTags = rawTags
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 10);

  // Extract visual summary
  const visualSummary =
    typeof data.visual_summary === "string"
      ? data.visual_summary.trim()
      : typeof data.summary === "string"
      ? data.summary.trim()
      : "";

  const primaryDiscipline = sanitizedDisciplines[0];
  const secondaryDisciplines = sanitizedDisciplines.slice(1);

  return {
    disciplines: sanitizedDisciplines,
    primary_discipline: primaryDiscipline,
    secondary_disciplines: secondaryDisciplines,
    visual_tags: sanitizedVisualTags,
    search_keywords: sanitizedVisualTags,
    visual_summary: visualSummary,

    // Legacy support for frontend components
    category: primaryDiscipline,
    tags: sanitizedVisualTags,
  };
}

export function buildLegacyLabels(sanitizedAnalysis) {
  if (!sanitizedAnalysis) return [];
  const labels = [];

  if (Array.isArray(sanitizedAnalysis.visual_tags)) {
    sanitizedAnalysis.visual_tags.forEach((tag) => {
      if (!labels.some((l) => l.name.toLowerCase() === tag.toLowerCase())) {
        labels.push({ name: tag });
      }
    });
  }

  return labels;
}

// ====================================================================
// 🔹 4. OPENAI API INVOCATION WITH RETRY
// ====================================================================
async function callVisionAPIWithRetry(
  openai,
  preferredModel,
  messages,
  responseFormat,
  maxRetries = 3
) {
  let currentModel = preferredModel;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await openai.chat.completions.create({
        model: currentModel,
        messages,
        response_format: responseFormat,
      });
    } catch (err) {
      const isRateLimit =
        err.status === 429 ||
        (err.message && err.message.toLowerCase().includes("rate limit"));

      if (isRateLimit && attempt < maxRetries) {
        currentModel = "gpt-4o-mini";
        const waitMs = attempt * 2000;
        await new Promise((res) => setTimeout(res, waitMs));
        continue;
      }

      throw err;
    }
  }
}

// ====================================================================
// 🔹 5. FILE TYPE & INPUT PREPARATION HELPERS
// ====================================================================
function getFileType(url) {
  try {
    const cleanUrl = url.split("?")[0].split("#")[0];
    const ext = path.extname(cleanUrl).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) return "image";
    if (VIDEO_EXTENSIONS.has(ext)) return "video";
  } catch (err) {
    // fallback
  }
  return "unknown";
}

async function prepareImageInput(url) {
  const bucketName = process.env.AWS_BUCKET_NAME;

  if (bucketName && url.includes(`${bucketName}.s3.`)) {
    const keyParts = url.split(`${bucketName}.s3.`)[1]?.split(".amazonaws.com/");
    if (keyParts && keyParts[1]) {
      const key = decodeURIComponent(keyParts[1]);
      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        try {
          const s3Client = new S3Client({
            region: process.env.AWS_REGION || "us-east-1",
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
          });
          const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
          const presignedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: 900,
          });
          return {
            type: "image_url",
            image_url: { url: presignedUrl, detail: "low" },
          };
        } catch (s3Err) {
          console.warn(
            `[OpenAI Vision] S3 Presigned URL failed for ${url}:`,
            s3Err.message
          );
        }
      }
    }
  }

  // Flat 85 input tokens per image detail: "low"
  return { type: "image_url", image_url: { url, detail: "low" } };
}

async function fetchAsBase64DataUri(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    headers: DEFAULT_HEADERS,
  });
  const contentType = response.headers["content-type"] || "image/jpeg";
  const base64 = Buffer.from(response.data, "binary").toString("base64");
  return `data:${contentType};base64,${base64}`;
}

// ====================================================================
// 🔹 6. VIDEO PROCESSING HELPERS
// ====================================================================
function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    try {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) return reject(err);
        const duration = metadata?.format?.duration;
        if (duration && !isNaN(duration)) {
          return resolve(parseFloat(duration));
        }
        resolve(0);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function calculateUltraFast3Timestamps(duration) {
  if (!duration || duration <= 1) {
    return [0, 0.5, 1.0];
  }
  const start = 0.1;
  const mid = duration / 2;
  const end = Math.max(start, duration - 0.1);
  return [
    parseFloat(start.toFixed(2)),
    parseFloat(mid.toFixed(2)),
    parseFloat(end.toFixed(2)),
  ];
}

async function downloadVideoToTempFile(url, tempDir) {
  const bucketName = process.env.AWS_BUCKET_NAME;
  let downloadUrl = url;

  if (bucketName && url.includes(`${bucketName}.s3.`)) {
    const keyParts = url.split(`${bucketName}.s3.`)[1]?.split(".amazonaws.com/");
    if (keyParts && keyParts[1]) {
      const key = decodeURIComponent(keyParts[1]);
      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        try {
          const s3Client = new S3Client({
            region: process.env.AWS_REGION || "us-east-1",
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
          });
          const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
          downloadUrl = await getSignedUrl(s3Client, command, {
            expiresIn: 900,
          });
        } catch (s3Err) {
          console.warn(
            `[Video Analysis] S3 presigned URL failed for video ${url}:`,
            s3Err.message
          );
        }
      }
    }
  }

  const cleanUrl = url.split("?")[0].split("#")[0];
  const ext = path.extname(cleanUrl) || ".mp4";
  const tempFilePath = path.join(
    tempDir,
    `video_${Date.now()}_${Math.random().toString(36).substring(2)}${ext}`
  );

  const response = await axios({
    method: "get",
    url: downloadUrl,
    headers: DEFAULT_HEADERS,
    responseType: "stream",
    timeout: 120000,
  });

  const writer = fs.createWriteStream(tempFilePath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  return tempFilePath;
}

async function extractScaledVideoFrames(videoFilePath, timestamps, outputDir) {
  const framePaths = [];

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const frameFileName = `frame_${i}_${Date.now()}.jpg`;
    const framePath = path.join(outputDir, frameFileName);

    await new Promise((resolve, reject) => {
      try {
        const proc = ffmpeg(videoFilePath)
          .seekInput(ts)
          .outputOptions(["-vf scale=480:-1", "-vframes 1", "-q:v 5"])
          .output(framePath)
          .on("end", () => resolve())
          .on("error", (err) => reject(err));

        proc.run();
      } catch (err) {
        reject(err);
      }
    });

    if (fs.existsSync(framePath)) {
      framePaths.push(framePath);
    }
  }

  if (framePaths.length === 0) {
    throw new Error("Failed to extract representative frames from video.");
  }

  return framePaths;
}

// ====================================================================
// 🔹 7. IMAGE & VIDEO ANALYZERS
// ====================================================================
async function analyzeSingleImage(openai, url, dbCategoryNames) {
  const model = process.env.OPENAI_VISION_MODEL || "gpt-5.6-luna";
  const jsonSchema = buildTaxonomyJsonSchema(dbCategoryNames);
  const systemPrompt = buildSystemPrompt(dbCategoryNames, "image");

  try {
    let imageInputPayload;
    try {
      imageInputPayload = await prepareImageInput(url);
    } catch (prepErr) {
      const dataUri = await fetchAsBase64DataUri(url);
      imageInputPayload = {
        type: "image_url",
        image_url: { url: dataUri, detail: "low" },
      };
    }

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Analyze this image asset and return SUB•SET taxonomy JSON.",
          },
          imageInputPayload,
        ],
      },
    ];

    let response;
    try {
      response = await callVisionAPIWithRetry(
        openai,
        model,
        messages,
        jsonSchema
      );
    } catch (apiErr) {
      if (
        imageInputPayload.image_url?.url &&
        !imageInputPayload.image_url.url.startsWith("data:")
      ) {
        const dataUri = await fetchAsBase64DataUri(url);
        const fallbackPayload = {
          type: "image_url",
          image_url: { url: dataUri, detail: "low" },
        };
        const fallbackMessages = [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this image asset and return SUB•SET taxonomy JSON.",
              },
              fallbackPayload,
            ],
          },
        ];
        response = await callVisionAPIWithRetry(
          openai,
          model,
          fallbackMessages,
          jsonSchema
        );
      } else {
        throw apiErr;
      }
    }

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) {
      throw new Error("Empty response received from OpenAI vision model.");
    }

    const parsedJson = JSON.parse(rawContent);
    const sanitizedAnalysis = validateAndSanitizeAnalysis(
      parsedJson,
      dbCategoryNames
    );
    const labels = buildLegacyLabels(sanitizedAnalysis);

    return {
      imageUrl: url,
      type: "image",
      analysis: sanitizedAnalysis,
      labels,
    };
  } catch (err) {
    console.error(`[OpenAI Vision] Error analyzing ${url}:`, err.message);
    return {
      imageUrl: url,
      type: "image",
      error: err.message || "Failed to analyze image.",
      analysis: null,
      labels: [],
    };
  }
}

async function analyzeSingleVideo(openai, url, dbCategoryNames) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "subset_video_"));
  let tempVideoPath = null;

  const jsonSchema = buildTaxonomyJsonSchema(dbCategoryNames);
  const systemPrompt = buildSystemPrompt(dbCategoryNames, "video");

  try {
    tempVideoPath = await downloadVideoToTempFile(url, tempDir);

    let duration = 0;
    try {
      duration = await getVideoDuration(tempVideoPath);
    } catch (durErr) {
      console.warn(
        `[Video Analysis] Could not determine duration:`,
        durErr.message
      );
    }

    const timestamps = calculateUltraFast3Timestamps(duration);
    const framePaths = await extractScaledVideoFrames(
      tempVideoPath,
      timestamps,
      tempDir
    );

    const framePayloads = framePaths.map((fPath) => {
      const base64Data = fs.readFileSync(fPath).toString("base64");
      return {
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${base64Data}`,
          detail: "low",
        },
      };
    });

    const model = process.env.OPENAI_VISION_MODEL || "gpt-5.6-luna";

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze keyframes and return SUB•SET taxonomy JSON.`,
          },
          ...framePayloads,
        ],
      },
    ];

    const response = await callVisionAPIWithRetry(
      openai,
      model,
      messages,
      jsonSchema
    );

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) {
      throw new Error("Empty response received from OpenAI vision model.");
    }

    const parsedJson = JSON.parse(rawContent);
    const sanitizedAnalysis = validateAndSanitizeAnalysis(
      parsedJson,
      dbCategoryNames
    );
    const labels = buildLegacyLabels(sanitizedAnalysis);

    return {
      imageUrl: url,
      type: "video",
      analysis: sanitizedAnalysis,
      labels,
    };
  } catch (err) {
    console.error(
      `[Video Analysis] Error analyzing video ${url}:`,
      err.message
    );
    return {
      imageUrl: url,
      type: "video",
      error: err.message || "Failed to analyze video.",
      analysis: null,
      labels: [],
    };
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanErr) {
      console.warn(`[Video Analysis] Cleanup temp error:`, cleanErr.message);
    }
  }
}

async function analyzeSingleAsset(openai, url, dbCategoryNames) {
  const cachedResult = analysisCache.get(url);
  if (cachedResult) {
    console.log(
      `[Cache Hit - 0 Tokens Spent] Serving cached result for ${url}`
    );
    return cachedResult;
  }

  const fileType = getFileType(url);
  let result;

  try {
    if (fileType === "video") {
      result = await analyzeSingleVideo(openai, url, dbCategoryNames);
    } else if (fileType === "image") {
      result = await analyzeSingleImage(openai, url, dbCategoryNames);
    } else {
      result = {
        imageUrl: url,
        type: fileType,
        error: "Unsupported format. Only images and videos supported.",
        analysis: null,
        labels: [],
      };
    }
  } catch (err) {
    console.error(`[Asset Analysis] Error processing ${url}:`, err.message);
    result = {
      imageUrl: url,
      type: fileType,
      error: err.message || "Failed to analyze asset.",
      analysis: null,
      labels: [],
    };
  }

  if (result && !result.error) {
    analysisCache.set(url, result);
  }

  return result;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (index < items.length) {
        const i = index++;
        results[i] = await fn(items[i], i);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

// ====================================================================
// 🔹 8. MAIN EXPRESS CONTROLLER HANDLER
// ====================================================================
export const analyzeS3Images = async (req, res) => {
  try {
    const { imageUrls } = req.body;

    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({
        success: false,
        message: "imageUrls must be a non-empty array.",
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === "your_key_here") {
      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
        error: "OpenAI API key is not configured.",
      });
    }

    const dbCategoryNames = await getDbCategoryNames();
    const openai = new OpenAI({ apiKey });
    const concurrencyLimit = parseInt(
      process.env.IMAGE_ANALYSIS_CONCURRENCY || "2",
      10
    );

    const results = await mapWithConcurrency(
      imageUrls,
      concurrencyLimit,
      async (url) => {
        return await analyzeSingleAsset(openai, url, dbCategoryNames);
      }
    );

    return res.status(200).json({
      success: true,
      total: results.length,
      data: results,
    });
  } catch (error) {
    console.error("❌ OpenAI Vision Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message || "An unexpected error occurred.",
    });
  }
};
