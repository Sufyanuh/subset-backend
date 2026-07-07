import { Spotlight } from "../../model/spotlight.js";

// ➕ Add Spotlight
export const AddSpotlight = async (req, res) => {
  const { discovery_ids, title, description, redirection_url } = req.body;
  try {
    if (!discovery_ids || !Array.isArray(discovery_ids) || discovery_ids.length === 0) {
      return res.status(400).json({ message: "At least one discovery is required" });
    }
    if (!title || !Array.isArray(title) || title.length === 0) {
      return res.status(400).json({ message: "At least one title tag is required" });
    }

    const spotlight = await Spotlight.create({
      discovery_ids,
      title,
      description,
      redirection_url,
    });

    return res
      .status(200)
      .json({ message: "Spotlight created successfully", data: spotlight });
  } catch (error) {
    return res.status(500).json({ message: error.message, error });
  }
};

// 📥 Get All Spotlights
export const GetSpotlights = async (req, res) => {
  try {
    const spotlights = await Spotlight.find({})
      .populate("discovery_ids")
      .sort({ createdAt: -1 });

    return res
      .status(200)
      .json({ message: "Spotlights fetched successfully", data: spotlights });
  } catch (error) {
    return res.status(500).json({ message: error.message, error });
  }
};

// 📥 Get Spotlight By ID
export const GetSpotlightById = async (req, res) => {
  const { id } = req.params;
  try {
    const spotlight = await Spotlight.findById(id).populate("discovery_ids");
    if (!spotlight) {
      return res.status(404).json({ message: "Spotlight not found" });
    }

    return res
      .status(200)
      .json({ message: "Spotlight fetched successfully", data: spotlight });
  } catch (error) {
    return res.status(500).json({ message: error.message, error });
  }
};

// ✏️ Update Spotlight
export const UpdateSpotlight = async (req, res) => {
  const { id } = req.params;
  const { discovery_ids, title, description, redirection_url } = req.body;
  try {
    if (discovery_ids !== undefined && (!Array.isArray(discovery_ids) || discovery_ids.length === 0)) {
      return res.status(400).json({ message: "At least one discovery is required" });
    }
    if (title !== undefined && (!Array.isArray(title) || title.length === 0)) {
      return res.status(400).json({ message: "At least one title tag is required" });
    }

    const updatedSpotlight = await Spotlight.findByIdAndUpdate(
      id,
      {
        ...(discovery_ids !== undefined && { discovery_ids }),
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(redirection_url !== undefined && { redirection_url }),
      },
      { new: true }
    );

    if (!updatedSpotlight) {
      return res.status(404).json({ message: "Spotlight not found" });
    }

    return res
      .status(200)
      .json({ message: "Spotlight updated successfully", data: updatedSpotlight });
  } catch (error) {
    return res.status(500).json({ message: error.message, error });
  }
};

// ❌ Delete Spotlight
export const DeleteSpotlight = async (req, res) => {
  const { id } = req.params;
  try {
    const spotlight = await Spotlight.findByIdAndDelete(id);
    if (!spotlight) {
      return res.status(404).json({ message: "Spotlight not found" });
    }

    return res
      .status(200)
      .json({ message: "Spotlight deleted successfully", data: spotlight });
  } catch (error) {
    return res.status(500).json({ message: error.message, error });
  }
};
