import { Message } from "../../model/chatMessage.js";
import { Conversation } from "../../model/conversation.js";
import { User } from "../../model/user.js";
import mongoose from "mongoose";
import { buildConversationId } from "../../services/buildConversationId.js";

export const getHistory = async (req, res) => {
  try {
    let conversationId;

    if (req.params.userId.includes(":")) {
      conversationId = req.params.userId;
    } else {
      const otherUserId = String(req.params.userId);
      const selfUserId = String(req.user._id);
      conversationId = buildConversationId(selfUserId, otherUserId);
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const cursor = req.query.cursor ? new Date(req.query.cursor) : null;

    const query = { conversationId };
    if (cursor) query.createdAt = { $lt: cursor };

    const messages = await Message.find(query)
      .populate("sender", "username fullName avatar")
      .populate("recipient", "username fullName avatar")
      .sort({ createdAt: 1 })
      .limit(limit + 1);

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? page[page.length - 1].createdAt : null;

    res.status(200).json({
      data: page,
      nextCursor,
      hasMore,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to load history" });
  }
};

export const markRead = async (req, res) => {
  try {
    const otherUserId = String(req.params.userId);
    const selfUserId = String(req.user._id);
    const conversationId = buildConversationId(selfUserId, otherUserId);

    const result = await Message.updateMany(
      {
        conversationId,
        recipient: selfUserId,
        readAt: { $exists: false },
      },
      { $set: { readAt: new Date() } }
    );

    // Reset unread counter in Conversation for this reader
    const [userA, userB] = [selfUserId, otherUserId].sort();
    const resetField = selfUserId === userA ? "unreadForA" : "unreadForB";
    await Conversation.findOneAndUpdate(
      { conversationId },
      { $set: { [resetField]: 0 } }
    );

    res.status(200).json({ updated: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ message: "Failed to mark read" });
  }
};

export const getInbox = async (req, res) => {
  try {
    const selfUserId = String(req.user._id);
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const skip = Number(req.query.skip) || 0;

    const conversations = await Conversation.find({
      $or: [{ userA: selfUserId }, { userB: selfUserId }],
    })
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const lastMessageIds = conversations
      .map((c) => c.lastMessageId)
      .filter(Boolean);
    const counterpartIds = conversations.map((c) =>
      String(c.userA) === selfUserId ? String(c.userB) : String(c.userA)
    );

    const [lastMessages, users, userDoc] = await Promise.all([
      Message.find({ _id: { $in: lastMessageIds } })
        .populate("sender", "username fullName avatar")
        .populate("recipient", "username fullName avatar")
        .lean(),
      User.find({ _id: { $in: counterpartIds } })
        .select("username fullName avatar")
        .lean(),
      User.findById(selfUserId).select("pinnedConversations").lean()
    ]);

    const idToMessage = new Map(lastMessages.map((m) => [String(m._id), m]));
    const idToUser = new Map(users.map((u) => [String(u._id), u]));
    const pinned = userDoc?.pinnedConversations || [];

    const items = conversations.map((c) => {
      const unreadCount =
        String(c.userA) === selfUserId ? c.unreadForA : c.unreadForB;
      const counterpartId =
        String(c.userA) === selfUserId ? String(c.userB) : String(c.userA);
      return {
        conversationId: c.conversationId,
        counterpart: idToUser.get(counterpartId) || null,
        lastMessage: c.lastMessageId
          ? idToMessage.get(String(c.lastMessageId))
          : null,
        unreadCount: unreadCount || 0,
        isPinned: pinned.includes(c.conversationId),
      };
    });

    const totalUnread = items.reduce(
      (sum, it) => sum + (it.unreadCount || 0),
      0
    );
    res.status(200).json({ data: items, totalUnread });
  } catch (err) {
    res.status(500).json({ message: "Failed to load inbox" });
  }
};

export const getNeverChattedUsers = async (req, res) => {
  try {
    const selfUserId = String(req.user._id);
    const search = String(req.query.search || "");
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const skip = Number(req.query.skip) || 0;

    // Prefer Conversation to avoid scanning whole Message collection
    const convs = await Conversation.find({
      $or: [{ userA: selfUserId }, { userB: selfUserId }],
    })
      .select("userA userB")
      .lean();

    const chattedWith = new Set(
      convs.map((c) =>
        String(c.userA) === selfUserId ? String(c.userB) : String(c.userA)
      )
    );

    const regex = search ? new RegExp(search, "i") : null;
    const query = {
      _id: { $ne: selfUserId, $nin: Array.from(chattedWith) },
      isActive: true,
      ...(regex ? { $or: [{ username: regex }, { fullName: regex }] } : {}),
    };

    const users = await User.find(query)
      .select("username fullName avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.status(200).json({ data: users });
  } catch (err) {
    res.status(500).json({ message: "Failed to load users" });
  }
};

export const deleteConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const selfUserId = String(req.user._id);

    const conversation = await Conversation.findOne({ conversationId });
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    if (String(conversation.userA) !== selfUserId && String(conversation.userB) !== selfUserId) {
      return res.status(403).json({ message: "Unauthorized to delete this conversation" });
    }

    await Promise.all([
      Conversation.deleteOne({ conversationId }),
      Message.deleteMany({ conversationId })
    ]);

    await User.updateMany(
      { $or: [{ _id: conversation.userA }, { _id: conversation.userB }] },
      { $pull: { pinnedConversations: conversationId } }
    );

    res.status(200).json({ success: true, message: "Conversation deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const togglePinConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const selfUserId = String(req.user._id);

    const conversation = await Conversation.findOne({ conversationId });
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    if (String(conversation.userA) !== selfUserId && String(conversation.userB) !== selfUserId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const user = await User.findById(selfUserId);
    const isPinned = user.pinnedConversations?.includes(conversationId);

    if (isPinned) {
      await User.findByIdAndUpdate(selfUserId, {
        $pull: { pinnedConversations: conversationId }
      });
    } else {
      await User.findByIdAndUpdate(selfUserId, {
        $addToSet: { pinnedConversations: conversationId }
      });
    }

    res.status(200).json({
      success: true,
      isPinned: !isPinned,
      message: isPinned ? "Conversation unpinned" : "Conversation pinned"
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
