import mongoose from "mongoose";
import dotenv from "dotenv";
import { Discover } from "../model/discover.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

const resolveVimeoThumbnail = async (id) => {
  try {
    const oembedUrl = `https://vimeo.com/api/oembed.json?url=https://vimeo.com/${id}&width=1280`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.thumbnail_url) return data.thumbnail_url;
    }
  } catch (err) {
    // fallback below
  }
  return `https://vumbnail.com/${id}.jpg`;
};

const backfill = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const vimeos = await Discover.find({
      sourceType: "vimeo",
      $or: [
        { thumbnail: { $exists: false } },
        { thumbnail: "" },
        { thumbnail: null },
      ],
    });

    console.log(`Found ${vimeos.length} Vimeo records without thumbnails.`);

    let updated = 0;
    const batchSize = 10;

    for (let i = 0; i < vimeos.length; i += batchSize) {
      const batch = vimeos.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (doc) => {
          const match = (doc.image || doc.source || "").match(
            /vimeo\.com\/(?:video\/)?([0-9]+)/
          );
          const vimeoId = match ? match[1] : null;

          if (vimeoId) {
            const thumb = await resolveVimeoThumbnail(vimeoId);
            if (thumb) {
              await Discover.updateOne(
                { _id: doc._id },
                { $set: { thumbnail: thumb } }
              );
              updated++;
            }
          }
        })
      );
      console.log(`Processed ${Math.min(i + batchSize, vimeos.length)}/${vimeos.length}...`);
    }

    console.log(`✅ Backfill completed! Updated ${updated} records.`);
    process.exit(0);
  } catch (err) {
    console.error("Backfill failed:", err);
    process.exit(1);
  }
};

backfill();
