import {
  RekognitionClient,
  DetectLabelsCommand,
} from "@aws-sdk/client-rekognition";
import axios from "axios";
import path from "path";

// ==============================
// 🔹 INIT REKOGNITION CLIENT
// ==============================
const rekognition = new RekognitionClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// ==============================
// 🔹 CONTROLLER FUNCTION
// ==============================
export const analyzeS3Images = async (req, res) => {
  try {
    const { imageUrls } = req.body;

    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res
        .status(400)
        .json({ message: "imageUrls must be a non-empty array." });
    }

    const bucketName = process.env.AWS_BUCKET_NAME;
    const results = [];

    for (const url of imageUrls) {
      let fileType = "unknown";
      const ext = path.extname(url).toLowerCase();
      if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"].includes(ext))
        fileType = "image";
      else if ([".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext))
        fileType = "video";
      try {
        let params = {};

        // ✅ Detect file type based on extension

        // ✅ Case 1: S3 Image or Video
        if (url.includes(`${bucketName}.s3.`)) {
          const key = url
            .split(`${bucketName}.s3.`)[1]
            .split(".amazonaws.com/")[1];
          if (!key) {
            results.push({
              imageUrl: url,
              type: fileType,
              error: "Invalid S3 URL format.",
            });
            continue;
          }

          params = {
            Image: {
              S3Object: { Bucket: bucketName, Name: key },
            },
            MaxLabels: 10,
            MinConfidence: 50,
          };
        }

        // ✅ Case 2: External Link (Unsplash, etc.)
        else {
          const response = await axios.get(url, {
            responseType: "arraybuffer",
          });
          const imageBytes = Buffer.from(response.data, "binary");

          params = {
            Image: { Bytes: imageBytes },
            MaxLabels: 10,
            MinConfidence: 50,
          };
        }

        // ✅ Skip if not image (Rekognition only supports image/video separately)
        // if (fileType !== "image") {
        //   results.push({
        //     imageUrl: url,
        //     type: fileType,
        //     message: "Skipped - Rekognition currently only supports image analysis here.",
        //   });
        //   continue;
        // }

        // 🔍 Run Rekognition
        const command = new DetectLabelsCommand(params);
        const rekognitionResult = await rekognition.send(command);

        const labels = rekognitionResult.Labels.map((label) => ({
          name: label.Name,
          confidence: label.Confidence.toFixed(2),
          categories: label.Categories?.map((cat) => cat.Name) || [],
        }));

        results.push({ imageUrl: url, type: fileType, labels });
      } catch (err) {
        console.error(`Error analyzing ${url}:`, err.message);
        results.push({
          imageUrl: url,
          type: fileType,
          error: err.message,
          labels: [],
        });
      }
    }

    return res.status(200).json({
      success: true,
      total: results.length,
      data: results,
    });
  } catch (error) {
    console.error("❌ Rekognition Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};
