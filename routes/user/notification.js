import express from "express";
import { checkAuthToken } from "../../middleware/checkToken.js";
import {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} from "../../controller/user/notification.js";

const router = express.Router();

router.get("/", checkAuthToken, listNotifications);
router.get("/unread-count", checkAuthToken, getUnreadCount);
router.post("/read/:id", checkAuthToken, markRead);
router.post("/read-all", checkAuthToken, markAllRead);

export default router;



