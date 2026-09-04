import { Router } from "express";

import { checkAuthToken } from "../../middleware/checkToken.js";
import {
  toggleSavedJobs,
  toggleConnection,
  submitJobPost,
} from "../../controller/user/jobs.js";

export const userJobsRouter = Router();

userJobsRouter.post("/submit", checkAuthToken, submitJobPost);
userJobsRouter.post("/save/:jobId", checkAuthToken, toggleSavedJobs);
userJobsRouter.post("/connect/:jobId", checkAuthToken, toggleConnection);

