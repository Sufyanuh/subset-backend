// uploadRoutes.js
import express from "express";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import { uploadMultipleFiles } from "../middleware/uploadMultipleFiles.js";
// import { checkAuthToken } from "../middleware/checkToken";

dotenv.config();

const FileUploadroutes = express.Router();

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// ✅ Upload route
FileUploadroutes.post("/upload-file", uploadMultipleFiles("files", 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: "No files uploaded." });
  }

  const filePaths = req.files.map((file) => ({
    url: file.location, // S3 file URL
    key: file.key, // S3 file key (for deletion)
    mediaType: file.mimetype.split("/")[0],
  }));

  res.status(200).json({
    message: "Files uploaded successfully.",
    files: filePaths,
  });
});

// ❌ Delete route
FileUploadroutes.post("/delete-file", async (req, res) => {
  const { filePath } = req.body; // fileKey = S3 key (not URL)
  if (!filePath) {
    return res.status(400).json({ message: "File key is required." });
  }

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: filePath,
      })
    );

    res.status(200).json({ message: "File deleted successfully." });
  } catch (err) {
    res.status(500).json({
      message: "Error deleting file from S3.",
      error: err.message,
    });
  }
});

export default FileUploadroutes;
