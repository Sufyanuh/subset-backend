import mongoose from "mongoose";
import dotenv from "dotenv";
import Post from "../model/post.js";

dotenv.config();

async function migrateLinks() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("Connected to MongoDB");

    // Find posts that don't have links field or have empty links array
    const postsToMigrate = await Post.find({
      $or: [
        { links: { $exists: false } },
        { links: [] },
        { links: { $size: 0 } }
      ]
    });

    console.log(`Found ${postsToMigrate.length} posts to process`);

    let migratedCount = 0;
    let skippedCount = 0;
    let emptyLinksCount = 0;

    // URL regex to match http/https URLs
    const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g;

    // Process posts in batches to avoid memory issues
    const batchSize = 100;
    for (let i = 0; i < postsToMigrate.length; i += batchSize) {
      const batch = postsToMigrate.slice(i, i + batchSize);
      const bulkOps = [];

      for (const post of batch) {
        // Check if post already has links (shouldn't happen due to query, but just in case)
        if (post.links && post.links.length > 0) {
          skippedCount++;
          continue;
        }

        let linksArray = [];

        // Extract URLs from title if exists
        if (post.title && urlRegex.test(post.title)) {
          const urls = post.title.match(urlRegex);
          
          if (urls && urls.length > 0) {
            // Remove duplicates and clean URLs
            const uniqueUrls = [...new Set(urls.map(url => {
              // Clean trailing punctuation
              let cleanUrl = url.trim();
              while (/[.,;:!?)>]$/.test(cleanUrl)) {
                cleanUrl = cleanUrl.slice(0, -1);
              }
              return cleanUrl;
            }))];

            // Create links array with unique URLs
            linksArray = uniqueUrls.map((url) => ({
              url: url,
              showPreview: true,
            }));

            migratedCount++;
            console.log(`Will migrate post ${post._id}: Found ${uniqueUrls.length} unique links`);
          } else {
            linksArray = [];
            emptyLinksCount++;
          }
        } else {
          linksArray = [];
          emptyLinksCount++;
        }

        // Add to bulk operation
        bulkOps.push({
          updateOne: {
            filter: { _id: post._id },
            update: {
              $set: { links: linksArray },
              $currentDate: { updatedAt: true }
            }
          }
        });
      }

      // Execute bulk write for this batch
      if (bulkOps.length > 0) {
        await Post.bulkWrite(bulkOps, { ordered: false });
        console.log(`Processed batch ${Math.floor(i/batchSize) + 1}: Updated ${bulkOps.length} posts`);
      }
    }

    console.log(`\nMigration Summary:`);
    console.log(`========================`);
    console.log(`Total posts checked: ${postsToMigrate.length}`);
    console.log(`Posts with links migrated: ${migratedCount}`);
    console.log(`Posts with empty links array: ${emptyLinksCount}`);
    console.log(`Posts skipped (already migrated): ${skippedCount}`);

    // Final verification
    console.log("\nVerifying migration...");
    const totalPosts = await Post.countDocuments({});
    const postsWithLinks = await Post.countDocuments({
      links: { $exists: true, $ne: [] }
    });
    const postsWithoutLinks = await Post.countDocuments({
      $or: [
        { links: { $exists: false } },
        { links: [] },
        { links: { $size: 0 } }
      ]
    });

    console.log(`\nFinal Statistics:`);
    console.log(`====================`);
    console.log(`Total posts in database: ${totalPosts}`);
    console.log(`Posts with links (non-empty): ${postsWithLinks}`);
    console.log(`Posts without links (empty/missing): ${postsWithoutLinks}`);

    // Show sample migrated posts
    console.log("\nSample migrated posts (first 5):");
    const samplePosts = await Post.find({ 
      links: { $exists: true, $ne: [] } 
    }).limit(5);
    
    samplePosts.forEach((post, index) => {
      console.log(`\n${index + 1}. Post ID: ${post._id}`);
      console.log(`   Title: ${post.title}`);
      console.log(`   Links count: ${post.links.length}`);
      post.links.forEach((link, linkIndex) => {
        console.log(`   Link ${linkIndex + 1}: ${link.url}`);
      });
    });

  } catch (error) {
    console.error("Migration error:", error);
    console.error("Stack trace:", error.stack);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected from MongoDB");
    process.exit(0);
  }
}

// Run the migration
migrateLinks();