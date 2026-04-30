import { Router } from "express";
import { getChannelsWithSubChannel } from "../../controller/admin/channels.js";

export const channelRoutes = Router();

channelRoutes.route("/").get(getChannelsWithSubChannel);

