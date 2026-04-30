import express from "express";
import { getAllMentors, getMentorById } from "../../controller/user/mentor.js";

const router = express.Router();

// GET /api/mentors - Get all mentors
router.get("/", getAllMentors);

// GET /api/mentors/:id - Get mentor by ID
router.get("/:id", getMentorById);

export default router; 