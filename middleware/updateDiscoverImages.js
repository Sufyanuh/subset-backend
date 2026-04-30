import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { Discover } from "../model/discover.js";

dotenv.config();

// ✅ AWS bucket details
const BUCKET_NAME = "subsetdevv1";
const REGION = "us-east-1";
const uploadsDir = path.join(process.cwd(), "uploads");

// ✅ Main update function
export const updateDiscoverImages = async () => {
  try {
    const files = fs.readdirSync(uploadsDir);
    console.log(`📸 Found ${files.length} files in uploads folder`);

    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      if (!fs.statSync(filePath).isFile()) continue;

      // Construct the S3 URL (no upload)
      const s3Url = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${file}`;

      // Find discover doc with old image path containing this file
      const doc = await Discover.findOne({
        image: { $regex: file, $options: "i" },
      });

      if (doc) {
        doc.image = s3Url;
        await doc.save();
        console.log(`✅ Updated: ${doc.title} → ${s3Url}`);
      } else {
        console.warn(`⚠ No document found for: ${file}`);
      }
    }

    console.log("🎉 All discover image URLs updated successfully!");
  } catch (err) {
    console.error("❌ Update failed:", err);
  } finally {
    mongoose.connection.close();
  }
};
