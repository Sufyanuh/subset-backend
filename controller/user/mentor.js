import { Mentor } from "../../model/mentor.js";

// Get all mentors
export const getAllMentors = async (req, res) => {
  try {
    const mentors = await Mentor.find().sort({ createdAt: -1 });
    res.status(200).json({ message: "Mentors fetched successfully", data: mentors });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch mentors", error: error.message });
  }
};

// Get a mentor by ID
export const getMentorById = async (req, res) => {
  const { id } = req.params;
  try {
    const mentor = await Mentor.findById(id);
    if (!mentor) {
      return res.status(404).json({ message: "Mentor not found" });
    }
    res.status(200).json({ message: "Mentor fetched successfully", data: mentor });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch mentor", error: error.message });
  }
}; 