import express from "express";
import {
  addMentor,
  getAllMentors,
  getMentorById,
  updateMentor,
  deleteMentor,
} from "../../controller/admin/mentor.js";
import { checkAuthToken } from "../../middleware/checkToken.js";
import { uploadSingleFile } from "../../middleware/uploadSingleFile.js";

const router = express.Router();

// POST /api/admin/mentors - Add a new mentor
router.post("/", checkAuthToken, uploadSingleFile("avatar"), addMentor);
// GET /api/admin/mentors - Get all mentors
router.get("/", checkAuthToken, getAllMentors);
// GET /api/admin/mentors/:id - Get mentor by ID
router.get("/:id", checkAuthToken, getMentorById);
// PUT /api/admin/mentors/:id - Update mentor by ID
router.post("/edit/:id", checkAuthToken, uploadSingleFile("avatar"), updateMentor);
// DELETE /api/admin/mentors/:id - Delete mentor by ID
router.delete("/:id", checkAuthToken, deleteMentor);

export default router;
