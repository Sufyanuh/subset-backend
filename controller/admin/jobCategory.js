import { JobCategory } from "../../model/jobCategory.js";
import { Job } from "../../model/job.js";

// ➕ Add Job Category
export const AddJobCategory = async (req, res) => {
  const { name } = req.body;
  try {
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Job category name is required" });
    }

    const existing = await JobCategory.findOne({ name: name.trim() });
    if (existing) {
      return res.status(400).json({ message: "Job category already exists" });
    }

    const count = await JobCategory.countDocuments();
    const category = await JobCategory.create({
      name: name.trim(),
      position: count,
    });

    return res
      .status(200)
      .json({ message: "Job category added successfully", data: category });
  } catch (error) {
    console.error("Error adding job category:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

// 📥 Get All Job Categories (sorted by position)
export const GetJobCategories = async (req, res) => {
  try {
    const categories = await JobCategory.find({}).sort({ position: 1 });
    return res
      .status(200)
      .json({ message: "Job categories fetched successfully", data: categories });
  } catch (error) {
    console.error("Error fetching job categories:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

// 📥 Get Single Job Category By ID
export const GetJobCategoryById = async (req, res) => {
  const { id } = req.params;
  try {
    const category = await JobCategory.findById(id);
    if (!category) {
      return res.status(404).json({ message: "Job category not found" });
    }
    return res
      .status(200)
      .json({ message: "Job category fetched successfully", data: category });
  } catch (error) {
    console.error("Error fetching job category by id:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

// ✏️ Update Job Category
export const UpdateJobCategory = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  try {
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Job category name is required" });
    }

    const existing = await JobCategory.findOne({
      _id: { $ne: id },
      name: name.trim(),
    });
    if (existing) {
      return res.status(400).json({ message: "Another job category with this name already exists" });
    }

    const category = await JobCategory.findByIdAndUpdate(
      id,
      { name: name.trim() },
      { new: true }
    );

    if (!category) {
      return res.status(404).json({ message: "Job category not found" });
    }

    return res
      .status(200)
      .json({ message: "Job category updated successfully", data: category });
  } catch (error) {
    console.error("Error updating job category:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

// ❌ Delete Job Category
export const DeleteJobCategory = async (req, res) => {
  const { id } = req.params;
  try {
    const category = await JobCategory.findByIdAndDelete(id);
    if (!category) {
      return res.status(404).json({ message: "Job category not found" });
    }

    return res
      .status(200)
      .json({ message: "Job category deleted successfully", data: category });
  } catch (error) {
    console.error("Error deleting job category:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

// 🔀 Reorder Job Categories
export const ReorderJobCategories = async (req, res) => {
  const { orderedIds } = req.body;

  if (!Array.isArray(orderedIds)) {
    return res
      .status(400)
      .json({ message: "Invalid payload. 'orderedIds' must be an array." });
  }

  try {
    const updatePromises = orderedIds.map((item, index) => {
      const id = typeof item === "string" ? item : item._id;
      return JobCategory.findByIdAndUpdate(id, { position: index });
    });

    await Promise.all(updatePromises);

    return res
      .status(200)
      .json({ message: "Job categories reordered successfully." });
  } catch (error) {
    console.error("Error reordering job categories:", error);
    return res.status(500).json({ message: error.message, error });
  }
};
