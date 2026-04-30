import { Categories } from "../../model/categories.js";
import { Discover } from "../../model/discover.js";

// ➕ Add Category
export const AddCategories = async (req, res) => {
  const { name } = req.body;
  try {
    const count = await Categories.countDocuments();
    const categories = await Categories.create({ name, position: count });
    return res
      .status(200)
      .json({ message: "Category added successfully", data: categories });
  } catch (errors) {
    return res.status(500).json({ message: errors.message, errors });
  }
};

// 📥 Get All Categories (sorted by position)
export const GetCategories = async (req, res) => {
  try {
    const categories = await Categories.find({}).sort({ position: 1 });
    return res
      .status(200)
      .json({ message: "Categories fetched", data: categories });
  } catch (errors) {
    return res.status(500).json({ message: errors.message, errors });
  }
};

// ❌ Delete Category
export const DeleteCategories = async (req, res) => {
  const { id } = req.params;
  try {
    const categories = await Categories.findByIdAndDelete(id);
    await Discover.updateMany(
      { categories: id },
      { $pull: { categories: id } }
    );
    return res
      .status(200)
      .json({ message: "Category deleted successfully", data: categories });
  } catch (errors) {
    return res.status(500).json({ message: errors.message, errors });
  }
};

// ✏️ Update Category Name
export const UpdateCategories = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  try {
    const categories = await Categories.findByIdAndUpdate(
      id,
      { name },
      { new: true }
    );
    return res
      .status(200)
      .json({ message: "Category updated successfully", data: categories });
  } catch (errors) {
    return res.status(500).json({ message: errors.message, errors });
  }
};

// 📥 Get One Category
export const GetCategoriesById = async (req, res) => {
  const { id } = req.params;
  try {
    const categories = await Categories.findById(id);
    return res
      .status(200)
      .json({ message: "Category fetched", data: categories });
  } catch (errors) {
    return res.status(500).json({ message: errors.message, errors });
  }
};

// 🔀 Reorder Categories (Admin Only)
export const ReorderCategories = async (req, res) => {
  const { orderedIds } = req.body; // e.g. [catId1, catId2, catId3]

  if (!Array.isArray(orderedIds)) {
    return res
      .status(400)
      .json({ message: "Invalid payload. 'orderedIds' must be an array." });
  }

  try {
    const updatePromises = orderedIds.map((id, index) => {
      return Categories.findByIdAndUpdate(id, { position: index });
    });

    await Promise.all(updatePromises);

    return res
      .status(200)
      .json({ message: "Categories reordered successfully." });
  } catch (errors) {
    return res.status(500).json({ message: errors.message, errors });
  }
};
