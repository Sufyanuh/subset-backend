import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

const s3 = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = "subsetdevv1";

/**
 * Delete a file from S3 given its full URL
 * @param {string} imageUrl - Full S3 URL (e.g. https://subsetdevv1.s3.us-east-1.amazonaws.com/abc.jpg)
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export const deleteFromS3 = async (imageUrl) => {
  try {
    if (!imageUrl) {
      throw new Error("Image URL is required");
    }

    // Extract key from URL (e.g. "abc.jpg" from full URL)
    const key = imageUrl.split(".amazonaws.com/")[1];
    if (!key) {
      throw new Error("Invalid S3 URL format");
    }

    // Delete from S3
    await s3.send(
      new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
    );

    console.log(`🗑️ Deleted from S3: ${key}`);
    return { success: true, message: "File deleted successfully." };
  } catch (err) {
    console.error("❌ Error deleting from S3:", err.message);
    return { success: false, message: err.message };
  }
};
