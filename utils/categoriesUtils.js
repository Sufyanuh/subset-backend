// categoriesUtils.js (or wherever you want this)

import { Categories } from "../model/categories.js";

export const initializeCategoryPositions = async () => {
  try {
    const categories = await Categories.find({}).sort({ _id: 1 });

    const updatePromises = categories.map((cat, index) =>
      Categories.findByIdAndUpdate(cat._id, { position: index })
    );

    await Promise.all(updatePromises);

    console.log("✅ Positions initialized for all categories.");
  } catch (error) {
    console.error("❌ Error initializing positions:", error.message);
  }
};
