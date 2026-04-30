import { Router } from "express";
import {
  createSubChannel,
  deleteSubChannelById,
  getSubChannelById,
  getSubChannels,
  updateSubChannelForAdmin,
  updateSubChannel,
  updateSubChannelPrivacy,
  getSubChannelWithChannelId,
  rearrangeSubChannels,
} from "../../controller/admin/subChannels.js";

export const subChannelRoutes = Router();
subChannelRoutes.route("/").post(createSubChannel).get(getSubChannels);
subChannelRoutes
  .route("/:id")
  .delete(deleteSubChannelById)
  .get(getSubChannelById)
  .patch(updateSubChannel);
subChannelRoutes.patch("/:id/privacy", updateSubChannelPrivacy);
subChannelRoutes.patch("/:id/for-admin", updateSubChannelForAdmin);
subChannelRoutes.get(
  "/getSubChannelWithChannelId/:channelId",
  getSubChannelWithChannelId
);
subChannelRoutes.post(
  "/rearrangeSubChannels/:channelId",
  rearrangeSubChannels
);
