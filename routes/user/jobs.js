import { Router } from "express";

import { checkAuthToken } from "../../middleware/checkToken.js";
import {
  toggleSavedJobs,
  toggleConnection,
  SubmitJob,
  UpdateUserJob,
} from "../../controller/user/jobs.js";

export const userJobsRouter = Router();

userJobsRouter.post("/submit", checkAuthToken, SubmitJob);
userJobsRouter.put("/:id", checkAuthToken, UpdateUserJob);
userJobsRouter.post("/save/:jobId", checkAuthToken, toggleSavedJobs);
userJobsRouter.post("/connect/:jobId", checkAuthToken, toggleConnection);

