import { Router } from "express";
import {
  CreateJob,
  DeleteJob,
  GetJobById,
  GetJobs,
  ToggleSpotLight,
  UpdateJob,
  updateJobStatus,
  approveJob,
  rejectJob,
  getPendingJobsCount,
  deleteMultipleJobs,
} from "../../controller/admin/job.js";

export const jobRouter = Router();

jobRouter.route("/pending-count").get(getPendingJobsCount);
jobRouter.route("/delete-multiple").post(deleteMultipleJobs).delete(deleteMultipleJobs);

jobRouter.route("/").post(CreateJob).get(GetJobs);

jobRouter.route("/:id").get(GetJobById).put(UpdateJob).delete(DeleteJob);

jobRouter.route("/:id/spotlight").put(ToggleSpotLight);

jobRouter.route("/:id/status").put(updateJobStatus);
jobRouter.route("/:id/approve").put(approveJob);
jobRouter.route("/:id/reject").put(rejectJob);
