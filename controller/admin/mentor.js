import { Mentor } from "../../model/mentor.js";
import { deleteFromS3 } from "../../services/deleteFromS3.js";

// Admin: Add a new mentor
export const addMentor = async (req, res) => {
  const {
    fullName,
    email,
    calendlyUrl,
    services,
    description,
    founder,
    tags,
    website,
    instagram,
    linkedin,
  } = req.body;

  const image = req?.file?.location; // .location for S3, .path for local fallback
  console.log("Uploaded image path:", image);
  if (!fullName || !email) {
    return res
      .status(400)
      .json({ message: "Full name and email are required." });
  }
  try {
    const existing = await Mentor.findOne({ email });
    if (existing) {
      return res
        .status(409)
        .json({ message: "Mentor with this email already exists." });
    }
    const mentor = new Mentor({
      fullName,
      avatar: image || null,
      email,
      calendlyUrl: calendlyUrl || null,
      description,
      founder,
      website,
      instagram,
      linkedin,
      tags: Array.isArray(tags) ? tags : JSON.parse(tags) || [],
      services: Array.isArray(services) ? services : JSON.parse(services) || [],
    });
    await mentor.save();
    res
      .status(201)
      .json({ message: "Mentor created successfully", data: mentor });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to create mentor", error: error.message });
  }
};

// Admin: Get all mentors
export const getAllMentors = async (req, res) => {
  try {
    const mentors = await Mentor.find().sort({ createdAt: -1 });
    res
      .status(200)
      .json({ message: "Mentors fetched successfully", data: mentors });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch mentors", error: error.message });
  }
};

// Admin: Get a mentor by ID
export const getMentorById = async (req, res) => {
  const { id } = req.params;
  try {
    const mentor = await Mentor.findById(id);
    if (!mentor) {
      return res.status(404).json({ message: "Mentor not found" });
    }
    res
      .status(200)
      .json({ message: "Mentor fetched successfully", data: mentor });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch mentor", error: error.message });
  }
};

// Admin: Update a mentor by ID
export const updateMentor = async (req, res) => {
  const { id } = req.params;
  const {
    fullName,
    email,
    calendlyUrl,
    services,
    description,
    founder,
    tags,
    website,
    instagram,
    linkedin,
  } = req.body;

  const image = req?.file?.location; // .location for S3, .path for local fallback
  console.log("Uploaded image path:", req?.file);

  if (!id) {
    return res.status(400).json({ message: "Mentor ID is required." });
  }

  if (!fullName || !email) {
    return res
      .status(400)
      .json({ message: "Full name and email are required." });
  }

  try {
    const mentor = await Mentor.findById(id);
    if (!mentor) {
      return res.status(404).json({ message: "Mentor not found." });
    }

    // Check for duplicate email with a different mentor
    const existing = await Mentor.findOne({ email, _id: { $ne: id } });
    if (existing) {
      return res
        .status(409)
        .json({ message: "Mentor with this email already exists." });
    }

    mentor.fullName = fullName;
    mentor.email = email;
    mentor.calendlyUrl = calendlyUrl || null;
    mentor.description = description;
    mentor.founder = founder;
    mentor.website = website;
    mentor.instagram = instagram;
    mentor.linkedin = linkedin;
    mentor.tags = Array.isArray(tags) ? tags : JSON.parse(tags || "[]");
    mentor.services = Array.isArray(services)
      ? services
      : JSON.parse(services || "[]");

    if (image) {
      mentor.avatar = image; // replace old avatar with new
    }

    await mentor.save();

    res
      .status(200)
      .json({ message: "Mentor updated successfully", data: mentor });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to update mentor", error: error.message });
  }
};

// Admin: Delete a mentor by ID
export const deleteMentor = async (req, res) => {
  const { id } = req.params;
  try {
    const mentor = await Mentor.findByIdAndDelete(id);
    // delete avatar from S3
    if (!mentor) {
      return res.status(404).json({ message: "Mentor not found" });
    }
    await deleteFromS3(mentor.avatar);
    res.status(200).json({ message: "Mentor deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to delete mentor", error: error.message });
  }
};
