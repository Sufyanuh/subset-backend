import { Router } from "express";
export const categoriesRouter = Router();
import {
  AddCategories,
  DeleteCategories,
  GetCategories,
  GetCategoriesById,
  ReorderCategories,
  UpdateCategories,
} from "../../controller/admin/categories.js";

categoriesRouter.route("/").post(AddCategories).get(GetCategories);
categoriesRouter.post("/reorder", ReorderCategories);

categoriesRouter
  .route("/:id")
  .delete(DeleteCategories)
  .put(UpdateCategories)
  .get(GetCategoriesById);
