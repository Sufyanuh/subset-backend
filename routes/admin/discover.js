import { Router } from "express";
import {
  AddDiscover,
  AddDiscoverManual,
  deleteDiscover,
  GetDiscover,
  GetDiscoverById,
  getRandomizedDiscover,
  updateDiscover,
  addRemoveDiscoverToLogin,
  deleteBulkDiscover,
  AddDiscoverVideo,
  AddDiscoverAudio,
  RandomizeDiscoverByDate,
  GetDiscoversByDate,
  SwapDiscoverIndex,
} from "../../controller/admin/discover.js";
import { uploadMultipleFiles } from "../../middleware/uploadMultipleFiles.js";

export const discoverRouter = Router();
discoverRouter.route("/").get(GetDiscover).post(AddDiscover);
discoverRouter.route("/video").post(AddDiscoverVideo);
discoverRouter.route("/audio").post(AddDiscoverAudio);
discoverRouter.get("/randomized", getRandomizedDiscover);
discoverRouter.post("/randomize-date", RandomizeDiscoverByDate);
discoverRouter.get("/date", GetDiscoversByDate);
discoverRouter.post("/toggle-login", addRemoveDiscoverToLogin);

discoverRouter.route("/swap-index").post(SwapDiscoverIndex);
discoverRouter
  .route("/manual")
  .post(uploadMultipleFiles("files"), AddDiscoverManual);

discoverRouter
  .route("/:id")
  .get(GetDiscoverById)
  .put(updateDiscover)
  .delete(deleteDiscover);

discoverRouter.delete("/bulk/delete", deleteBulkDiscover);
