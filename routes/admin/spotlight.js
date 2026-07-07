import { Router } from "express";
import {
  AddSpotlight,
  DeleteSpotlight,
  GetSpotlights,
  GetSpotlightById,
  UpdateSpotlight,
} from "../../controller/admin/spotlight.js";

export const spotlightRouter = Router();

spotlightRouter.route("/").post(AddSpotlight).get(GetSpotlights);
spotlightRouter
  .route("/:id")
  .get(GetSpotlightById)
  .put(UpdateSpotlight)
  .delete(DeleteSpotlight);
