import express from "express";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from "dotenv";

dotenv.config();
const S3routes = express.Router();

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

S3routes.get("/presign", async (req, res) => {
  try {
    const { fileName, fileType } = req.query;

    if (!fileName || !fileType) {
      return res.status(400).json({ message: "Missing fileName or fileType" });
    }

    const key = `${Date.now()}-${fileName.replace(/\s+/g, "_")}`;

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      ContentType: fileType,
    });

    const uploadURL = await getSignedUrl(s3, command, { expiresIn: 3600 });
    const fileURL = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

    res.json({ uploadURL, fileURL });
  } catch (error) {
    console.error("Presign Error:", error);
    res.status(500).json({ message: "Failed to generate presigned URL" });
  }
});

export default S3routes;
