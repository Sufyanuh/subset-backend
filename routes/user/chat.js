import express from "express";
import {
    getHistory,
    getInbox,
    getNeverChattedUsers,
    markRead,
    deleteConversation,
    togglePinConversation,
} from "../../controller/user/Chat.js";
import { checkAuthToken } from "../../middleware/checkToken.js";

const router = express.Router();

// Get message history with a user
router.get("/history/:userId", checkAuthToken, getHistory);

// Mark messages as read in a conversation
router.post("/read/:userId", checkAuthToken, markRead);

// Inbox: last message per conversation + unread counts
router.get("/inbox", checkAuthToken, getInbox);

// Users never chatted with current user
router.get("/never-chatted", checkAuthToken, getNeverChattedUsers);

// Delete conversation
router.delete("/conversation/:conversationId", checkAuthToken, deleteConversation);

// Pin/Unpin conversation
router.post("/conversation/:conversationId/pin", checkAuthToken, togglePinConversation);

export default router;


