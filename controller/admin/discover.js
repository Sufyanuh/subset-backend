import { Discover } from "../../model/discover.js";
import { DiscoverforLogin } from "../../model/discoverforLogin.js";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import { deleteFromS3 } from "../../services/deleteFromS3.js";
import { getDiscoversByDateSafe } from "../../services/getDiscoversByDateSafe.js";

dotenv.config();

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
export const AddDiscover = async (req, res) => {
  try {
    const { image, source } = req.body;

    if (!image || !Array.isArray(image) || image.length === 0) {
      return res.status(400).json({ message: "Data required" });
    }

    const uploadAt = new Date();
    const dateKey = uploadAt.toISOString().split("T")[0];

    // 🔥 STEP 1: existing records shift karo (same date)
    await Discover.updateMany(
      {
        uploadAt: {
          $gte: new Date(dateKey),
          $lt: new Date(dateKey + "T23:59:59.999Z"),
        },
      },
      {
        $inc: { index: image.length }, // 👈 shift by new items count
      },
    );

    // 🔥 STEP 2: new items prepare karo
    const newDocs = image.map((item, i) => {
      if (!item.url || !item.tag || !item.categories || !item.title) {
        throw new Error(`Item ${i + 1} missing required fields`);
      }

      return {
        title: item.title,
        image: item.url,
        type: item.type || "image",
        tags: item.tag,
        categories: item.categories,
        source: source || "",
        thumbnail: item.thumbnail || "",
        uploadAt,
        index: i, // 👈 always start from 0
      };
    });

    // 🔥 STEP 3: bulk insert
    await Discover.insertMany(newDocs);

    res.status(200).json({
      message: "Discover added successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};
export const AddDiscoverVideo = async (req, res) => {
  try {
    const { image, source, sourceType } = req.body;

    if (!image || !Array.isArray(image) || image.length === 0) {
      return res.status(400).json({ message: "Video required" });
    }

    const uploadAt = new Date();
    const startOfDay = new Date(uploadAt.toISOString().split("T")[0]);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    // 🔥 STEP 1: existing same-day records shift karo
    await Discover.updateMany(
      {
        uploadAt: { $gte: startOfDay, $lte: endOfDay },
      },
      {
        $inc: { index: image.length },
      },
    );

    // 🔥 STEP 2: new docs prepare karo
    const newVideos = image.map((vid, i) => {
      if (!vid.url || !vid.tags || !vid.categories || !vid.title) {
        throw new Error(
          `Video ${i + 1} ka URL, Tags, Categories aur Title required hai`,
        );
      }

      return {
        title: vid.title,
        image: vid.thumbnail || vid.url, // thumbnail fallback
        videoUrl: vid.url,
        type: "video",
        tags: vid.tags,
        categories: vid.categories,
        source: source || "",
        sourceType: sourceType || "",
        uploadAt,
        index: i, // 👈 always start from 0
      };
    });

    // 🔥 STEP 3: bulk insert
    await Discover.insertMany(newVideos);

    res.status(200).json({
      message: "Video discover successfully add",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};
export const AddDiscoverAudio = async (req, res) => {
  try {
    const { image, source, sourceType } = req.body;

    if (!image || !Array.isArray(image) || image.length === 0) {
      return res.status(400).json({ message: "Audio required" });
    }

    const uploadAt = new Date();
    const startOfDay = new Date(uploadAt.toISOString().split("T")[0]);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    // 🔥 STEP 1: existing same-day shift
    await Discover.updateMany(
      {
        uploadAt: { $gte: startOfDay, $lte: endOfDay },
      },
      {
        $inc: { index: image.length },
      },
    );

    // 🔥 STEP 2: prepare bulk insert
    const audioDocs = image.map((audio, i) => {
      if (!audio.url || !audio.tags || !audio.categories || !audio.title) {
        throw new Error(
          `Audio ${i + 1} ka URL, Tags, Categories aur Title required hai`,
        );
      }

      return {
        title: audio.title,
        image: audio.url, // audio file URL
        thumbnail: audio.thumbnail || "",
        type: "mp3",
        tags: audio.tags,
        categories: audio.categories,
        source: source || "",
        sourceType: sourceType || "",
        uploadAt,
        index: i, // 👈 reset per batch
      };
    });

    // 🔥 STEP 3: fast insert
    await Discover.insertMany(audioDocs);

    res.status(200).json({
      message: "Audio discover successfully added",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};
export const AddDiscoverManual = async (req, res) => {
  try {
    const { title, image, categories, source, sourceType } = req.body;

    if (!title || !image || !categories) {
      return res.status(400).json({
        message: "Title, image and categories are required",
      });
    }

    if (!Array.isArray(image) || image.length === 0) {
      return res.status(400).json({
        message: "Image array required",
      });
    }

    const uploadAt = new Date();

    const startOfDay = new Date(uploadAt.toISOString().split("T")[0]);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    // 🔥 STEP 1: shift existing same-day records
    await Discover.updateMany(
      {
        uploadAt: { $gte: startOfDay, $lte: endOfDay },
      },
      {
        $inc: { index: image.length },
      },
    );

    // 🔥 STEP 2: prepare bulk insert
    const docs = image.map((img, i) => {
      if (!img.url || !img.type) {
        throw new Error(`Image ${i + 1} missing required fields`);
      }

      return {
        title,
        image: img.url,
        type: img.type,
        tags: img.tag || [],
        source: source || "",
        sourceType: sourceType || "",
        categories,
        uploadAt,
        index: i, // 👈 reset per batch
      };
    });

    // 🔥 STEP 3: fast insert
    await Discover.insertMany(docs);

    res.status(200).json({
      message: "Discover added successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

export const GetDiscover = async (req, res) => {
  try {
    const [discover, discoverForLoginDocs] = await Promise.all([
      Discover.aggregate([
        {
          $addFields: {
            dateOnly: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$uploadAt",
              },
            },
          },
        },

        // 🔥 join categories collection
        {
          $lookup: {
            from: "categories", // collection name (IMPORTANT)
            localField: "categories",
            foreignField: "_id",
            as: "categories",
          },
        },

        {
          $sort: {
            dateOnly: -1,
            index: 1,
          },
        },
      ]),

      DiscoverforLogin.find({}, "discoverId").lean(),
    ]);

    const discoverIdsInLogin = new Set(
      (discoverForLoginDocs || []).map((doc) => String(doc.discoverId)),
    );

    const dataWithLoginFlag = (discover || []).map((doc) => ({
      ...doc,
      isAddedToLogin: discoverIdsInLogin.has(String(doc._id)),
    }));

    res.status(200).json({
      data: dataWithLoginFlag,
      message: "Discover fetched successfully",
    });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ message: errors.message, errors });
  }
};

export const GetDiscoverById = async (req, res) => {
  const reqId = req.params.id;
  try {
    const discover = await Discover.findById(reqId).populate("categories");
    if (!discover) {
      return res.status(404).json({ message: "Discover not found" });
    }
    res
      .status(200)
      .json({ data: discover, message: "Discover fetched successfully" });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ message: errors.message, errors });
  }
};

export const updateDiscover = async (req, res) => {
  const reqId = req.params.id;
  const { title, image, tags, categories } = req.body;

  try {
    const updatedDiscover = await Discover.findByIdAndUpdate(
      reqId,
      {
        ...(title && { title }),
        ...(image && { image }),
        ...(tags && { tags }),
        ...(categories && { categories }),
      },
      { new: true }, // returns the updated document
    );

    if (!updatedDiscover) {
      return res.status(404).json({ message: "Discover not found" });
    }

    res.status(200).json({
      data: updatedDiscover,
      message: "Discover updated successfully",
    });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ message: errors.message, errors });
  }
};

export const deleteDiscover = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "ID is required" });
    }

    // 🟢 Find entry first to get its date
    const discover = await Discover.findById(id);
    if (!discover) {
      return res.status(404).json({ message: "Discover not found" });
    }

    const dateKey = new Date(discover.uploadAt).toISOString().split("T")[0];

    // 🟢 Find and delete discover entry
    await Discover.findByIdAndDelete(id);
    await DiscoverforLogin.deleteMany({ discoverId: id });

    // 🟢 Delete related file from S3 (if it exists)
    if (
      discover.image &&
      discover.image.includes("https://subsetdevv1.s3.us-east-1.amazonaws.com")
    ) {
      await deleteFromS3(discover.image);
    }

    // 🟢 Fix Index Gaps (Re-sequence the remaining items on the same UTC date)
    const start = new Date(dateKey);
    const end = new Date(dateKey + "T23:59:59.999Z");

    const remainingDocs = await Discover.find({
      uploadAt: { $gte: start, $lte: end },
    }).sort({ index: 1 });

    if (remainingDocs.length > 0) {
      const bulkOps = remainingDocs.map((doc, i) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { index: i } },
        },
      }));
      await Discover.bulkWrite(bulkOps);
    }

    // ✅ Success response
    res
      .status(200)
      .json({ message: "Discover deleted successfully and indices adjusted" });
  } catch (errors) {
    console.error("Error in deleteDiscover:", errors);
    res.status(500).json({ message: errors.message, errors });
  }
};

export const deleteBulkDiscover = async (req, res) => {
  console.log(req.body, "<=======req.body");
  try {
    const { ids } = req.body;
    // Validate input
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "Array of IDs is required",
        example: { ids: ["id1", "id2", "id3"] },
      });
    }

    // Validate each ID
    const validIds = ids.filter(
      (id) => id && typeof id === "string" && id.trim() !== "",
    );
    if (validIds.length === 0) {
      return res.status(400).json({ message: "No valid IDs provided" });
    }

    // 🟢 Find all discover entries to be deleted
    const discovers = await Discover.find({ _id: { $in: validIds } });

    if (discovers.length === 0) {
      return res
        .status(404)
        .json({ message: "No discovers found with the provided IDs" });
    }

    // Capture affected dates before deletion
    const affectedDates = new Set(
      discovers.map(
        (doc) => new Date(doc.uploadAt).toISOString().split("T")[0],
      ),
    );

    // 🟢 Extract image URLs for S3 deletion
    const s3ImageUrls = discovers
      .filter(
        (discover) =>
          discover.image &&
          discover.image.includes(
            "https://subsetdevv1.s3.us-east-1.amazonaws.com",
          ),
      )
      .map((discover) => discover.image);

    // 🟢 Delete all discover entries
    const deleteResult = await Discover.deleteMany({ _id: { $in: validIds } });

    // 🟢 Delete related DiscoverforLogin entries
    await DiscoverforLogin.deleteMany({ discoverId: { $in: validIds } });

    // 🟢 Delete files from S3 (parallel deletion for efficiency)
    if (s3ImageUrls.length > 0) {
      const deletePromises = s3ImageUrls.map((url) => deleteFromS3(url));
      await Promise.allSettled(deletePromises); // Use allSettled to continue even if some deletions fail
    }

    // 🟢 Fix Index Gaps (Re-sequence remaining items for each affected UTC date)
    for (const dateKey of affectedDates) {
      const start = new Date(dateKey);
      const end = new Date(dateKey + "T23:59:59.999Z");

      const remainingDocs = await Discover.find({
        uploadAt: { $gte: start, $lte: end },
      }).sort({ index: 1 });

      if (remainingDocs.length > 0) {
        const bulkOps = remainingDocs.map((doc, i) => ({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { index: i } },
          },
        }));
        await Discover.bulkWrite(bulkOps);
      }
    }

    // ✅ Success response
    res.status(200).json({
      message: `${deleteResult.deletedCount} discover item(s) deleted successfully`,
      deletedCount: deleteResult.deletedCount,
      requestedIds: validIds.length,
      foundAndDeleted: discovers.length,
    });
  } catch (error) {
    console.error("Error in deleteBulkDiscover:", error);
    res.status(500).json({
      message: "Failed to delete discover items",
      error: error.message,
    });
  }
};

export const getRandomizedDiscover = async (req, res) => {
  try {
    // 🔥 STEP 1: saara data lao
    const discovers = await Discover.find({
      uploadAt: { $exists: true },
    }).lean();

    if (!discovers.length) {
      return res.status(404).json({ message: "No discovers found" });
    }

    // 🔥 STEP 2: group by date
    const groups = {};

    discovers.forEach((doc) => {
      const dateKey = new Date(doc.uploadAt).toISOString().split("T")[0];

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }

      groups[dateKey].push(doc);
    });

    // shuffle each group
    let bulkOps = [];

    Object.keys(groups).forEach((date) => {
      const items = groups[date];

      // Fisher-Yates shuffle
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }

      // assign new indexes
      items.forEach((doc, i) => {
        bulkOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: { index: i },
            },
          },
        });
      });
    });

    //bulk update
    await Discover.bulkWrite(bulkOps);

    res.status(200).json({
      message: "All dates randomized successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

export const RandomizeDiscoverByDate = async (req, res) => {
  try {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ message: "startDate and endDate are required" });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (end < start) {
      return res.status(400).json({
        message: "endDate cannot be earlier than startDate",
      });
    }

    // 🔥 Fetch only required fields (performance boost)
    const discovers = await Discover.aggregate([
      {
        $addFields: {
          dateOnly: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$uploadAt",
            },
          },
        },
      },
      {
        $match: {
          dateOnly: {
            $gte: startDate,
            $lte: endDate,
          },
        },
      },
      {
        $project: {
          _id: 1,
          title: 1,
          dateOnly: 1,
        },
      },
    ]);

    if (!discovers.length) {
      return res.status(404).json({
        message: "No data found in this date range",
      });
    }

    // 👉 Group by date
    const groups = {};
    for (const doc of discovers) {
      if (!groups[doc.dateOnly]) groups[doc.dateOnly] = [];
      groups[doc.dateOnly].push(doc);
    }

    let bulkOps = [];

    Object.keys(groups).forEach((dateKey) => {
      const items = groups[dateKey];

      // 👉 Group by title
      const titleGroups = {};
      items.forEach((item) => {
        const key = item.title.join(",");
        if (!titleGroups[key]) titleGroups[key] = [];
        titleGroups[key].push(item);
      });

      const keys = Object.keys(titleGroups);

      // ✅ CASE 1: Only one title → simple shuffle
      if (keys.length === 1) {
        const shuffled = titleGroups[keys[0]]
          .map((i) => ({ ...i, rand: Math.random() }))
          .sort((a, b) => a.rand - b.rand);

        shuffled.forEach((doc, i) => {
          bulkOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: { $set: { index: i } },
            },
          });
        });

        return;
      }

      // 👉 Shuffle each title group
      keys.forEach((key) => {
        titleGroups[key] = titleGroups[key]
          .map((i) => ({ ...i, rand: Math.random() }))
          .sort((a, b) => a.rand - b.rand);
      });

      // 👉 Balanced distribution (no clustering)
      let queue = keys
        .map((key) => ({
          key,
          items: titleGroups[key],
        }))
        .sort((a, b) => b.items.length - a.items.length);

      const merged = [];
      let lastTitle = null;

      while (queue.length > 0) {
        let nextQueue = [];

        for (let i = 0; i < queue.length; i++) {
          const group = queue[i];

          if (group.items.length === 0) continue;

          // avoid same title consecutively
          if (group.key === lastTitle && queue.length > 1) {
            nextQueue.push(group);
            continue;
          }

          const item = group.items.shift();
          merged.push(item);
          lastTitle = group.key;

          if (group.items.length > 0) {
            nextQueue.push(group);
          }
        }

        // reshuffle priority (largest first)
        queue = nextQueue.sort((a, b) => b.items.length - a.items.length);
      }

      // 👉 Assign index
      merged.forEach((doc, i) => {
        bulkOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { index: i } },
          },
        });
      });
    });

    await Discover.bulkWrite(bulkOps);

    return res.status(200).json({
      message: "Randomized successfully across the date range",
      count: discovers.length,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message });
  }
};

export const GetDiscoversByDate = async (req, res) => {
  try {
    const { startDate, endDate } = req.query; // ?startDate=2026-03-25&endDate=2026-03-28

    if (!startDate || !endDate) {
      return res.status(400).json({
        message: "startDate and endDate are required",
      });
    }

    // 🔥 timezone-safe approach using aggregation
    const discovers = await Discover.aggregate([
      {
        $addFields: {
          dateOnly: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$uploadAt",
            },
          },
        },
      },
      {
        $match: {
          dateOnly: {
            $gte: startDate,
            $lte: endDate,
          },
        },
      },
      {
        $sort: {
          dateOnly: -1, // latest date first
          index: 1, // then index
        },
      },
      {
        $lookup: {
          from: "categories", // ⚠️ apni collection ka exact name check karo
          localField: "categories",
          foreignField: "_id",
          as: "categories",
        },
      },
    ]);

    return res.status(200).json({
      data: discovers,
      count: discovers.length,
      message: "Discover fetched successfully (date range)",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message });
  }
};

export const SwapDiscoverIndex = async (req, res) => {
  try {
    const { id, newIndex, date } = req.body;

    if (!id || newIndex === undefined || !date) {
      return res.status(400).json({
        message: "id, newIndex and date are required",
      });
    }

    // 🔥 STEP 1: date range (safe)
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    // 🔥 STEP 2: get all records for that date
    const discovers = await Discover.find({
      uploadAt: { $gte: start, $lte: end },
    }).lean();

    if (!discovers.length) {
      return res.status(404).json({
        message: "No discovers found for this date",
      });
    }

    // 🔥 STEP 3: validation (index range)
    if (newIndex < 0) {
      return res.status(400).json({
        message: `Index out of range.`,
      });
    }

    // 🔥 STEP 4: find current doc
    const currentDoc = discovers.find((d) => String(d._id) === id);

    if (!currentDoc) {
      return res.status(404).json({
        message: "Discover not found",
      });
    }

    const oldIndex = currentDoc.index;

    if (oldIndex === newIndex) {
      return res.status(200).json({
        message: "Index already same, no change",
      });
    }

    // 🔥 STEP 5: find target doc (jis se swap hoga)
    const targetDoc = discovers.find((d) => d.index === newIndex);

    if (!targetDoc) {
      return res.status(404).json({
        message: "Target index not found",
      });
    }

    // 🔥 STEP 6: swap indexes
    await Discover.bulkWrite([
      {
        updateOne: {
          filter: { _id: currentDoc._id },
          update: { $set: { index: newIndex } },
        },
      },
      {
        updateOne: {
          filter: { _id: targetDoc._id },
          update: { $set: { index: oldIndex } },
        },
      },
    ]);

    return res.status(200).json({
      message: "Index swapped successfully",
      from: oldIndex,
      to: newIndex,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message });
  }
};

export const addRemoveDiscoverToLogin = async (req, res) => {
  try {
    const { discoverId } = req.body;
    if (!discoverId) {
      return res.status(400).json({ message: "discoverId is required" });
    }

    const existing = await DiscoverforLogin.findOne({ discoverId });
    if (!existing) {
      await DiscoverforLogin.create({ discoverId });
      return res
        .status(200)
        .json({ message: "Discover added to Login page", added: true });
    }

    await DiscoverforLogin.deleteOne({ _id: existing._id });
    return res
      .status(200)
      .json({ message: "Discover removed from Login page", added: false });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const GetDiscoverToLogin = async (req, res) => {
  try {
    const discover = await DiscoverforLogin.find({}).populate("discoverId");
    return res.status(200).json({ data: discover });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
