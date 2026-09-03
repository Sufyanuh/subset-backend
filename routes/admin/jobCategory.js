import { Router } from "express";
import {
  AddJobCategory,
  DeleteJobCategory,
  GetJobCategories,
  GetJobCategoryById,
  ReorderJobCategories,
  UpdateJobCategory,
} from "../../controller/admin/jobCategory.js";

export const jobCategoryRouter = Router();

jobCategoryRouter.route("/").post(AddJobCategory).get(GetJobCategories);
jobCategoryRouter.post("/reorder", ReorderJobCategories);

jobCategoryRouter
  .route("/:id")
  .get(GetJobCategoryById)
  .put(UpdateJobCategory)
  .delete(DeleteJobCategory);
