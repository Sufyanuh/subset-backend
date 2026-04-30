import mongoose from "mongoose";
import { Discover } from "../model/discover.js";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

const runMigration = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("DB connected");

    // 1️⃣ saara data lao (uploadAt ke hisaab se sort)
    const discovers = await Discover.find({
      uploadAt: { $exists: true },
    })
      .sort({ uploadAt: 1 }) // oldest → newest
      .lean();

    // 2️⃣ group by date (YYYY-MM-DD)
    const groups = {};

    discovers.forEach((doc) => {
      const dateKey = new Date(doc.uploadAt).toISOString().split("T")[0];

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }

      groups[dateKey].push(doc);
    });

    // 3️⃣ har group me index reset karo
    let bulkOps = [];
    let total = 0;

    Object.keys(groups).forEach((date) => {
      const items = groups[date];

      // 👇 IMPORTANT: latest first lao
      items.sort((a, b) => new Date(b.uploadAt) - new Date(a.uploadAt));

      items.forEach(async (doc, i) => {
        bulkOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                index: i, // 👈 ab latest ko index 0 milega
              },
            },
          },
        });

        total++;

        if (bulkOps.length === 500) {
          await Discover.bulkWrite(bulkOps); // 👈 await add karo (important)
          console.log(`${total} updated...`);
          bulkOps = [];
        }
      });
    });

    // remaining
    if (bulkOps.length > 0) {
      await Discover.bulkWrite(bulkOps);
    }

    console.log("✅ Index migration completed");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
};
// const runMigration = async () => {
//   try {
//     await mongoose.connect(MONGO_URI);
//     console.log("DB connected");

//     const cursor = Discover.find({
//       createdAt: { $exists: false },
//     }).cursor();

//     let bulkOps = [];
//     let count = 0;

//     for await (const doc of cursor) {
//       const createdAt = doc._id.getTimestamp();

//       bulkOps.push({
//         updateOne: {
//           filter: { _id: doc._id },
//           update: {
//             $set: {
//               uploadAt: createdAt,
//               updatedAt: createdAt,
//             },
//           },
//         },
//       });

//       count++;

//       // 🚀 batch execute (performance ke liye)
//       if (bulkOps.length === 500) {
//         await Discover.bulkWrite(bulkOps);
//         console.log(`${count} records updated...`);
//         bulkOps = [];
//       }
//     }

//     // remaining updates
//     if (bulkOps.length > 0) {
//       await Discover.bulkWrite(bulkOps);
//       console.log(`${count} records updated (final batch)...`);
//     }

//     console.log("✅ Migration completed");
//     process.exit(0);
//   } catch (error) {
//     console.error("❌ Migration error:", error);
//     process.exit(1);
//   }
// };
runMigration();
