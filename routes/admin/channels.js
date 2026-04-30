import { Router } from "express";
import {
  AddChannel,
  DeleteChannel,
  getChannel,
  getChannels,
  getChannelsWithSubChannel,
  UpdateChannel,
  rearrangeChannels,
} from "../../controller/admin/channels.js";
export const channelRouter = Router();

channelRouter.route("/").get(getChannels).post(AddChannel);
channelRouter.get("/withsubchannels", getChannelsWithSubChannel);
channelRouter
  .route("/:id")
  .get(getChannel)
  .put(UpdateChannel)
  .delete(DeleteChannel);
channelRouter.post("/rearrangeChannels", rearrangeChannels);
