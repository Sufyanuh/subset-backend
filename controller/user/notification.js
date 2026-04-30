import { Notification } from "../../model/notification.js";
import { getIo } from "../../services/socket.js";

export const listNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = Number(req.query.limit || 20);
    const skip = Number(req.query.skip || 0);
    const cursor = req.query.cursor ? new Date(req.query.cursor) : null;
    const filter = req.query.filter; // 'mentions', 'messages', 'replies', 'comments', 'all'

    const query = { recipient: userId };
    if (cursor) query.createdAt = { $lt: cursor };

    // Apply filter based on notification type and title patterns
    if (filter && filter !== 'all') {
      switch (filter) {
        case 'mentions':
          query.$or = [
            { title: { $regex: /mentioned you in a post/i } },
            { title: { $regex: /mentioned you in a comment/i } }
          ];
          break;
        case 'messages':
          query.type = 'message';
          break;
        case 'replies':
          query.$or = [
            { title: { $regex: /replied to your comment/i } },
            { title: { $regex: /commented on your post/i } }
          ];
          break;
        case 'comments':
          query.type = 'comment';
          break;
        case 'likes':
          query.$or = [
            { title: { $regex: /liked your post/i } },
            { title: { $regex: /liked your comment/i } }
          ];
          break;
      }
    }

    const items = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("actor", "username fullName avatar")
      .lean();

    const unreadCount = await Notification.countDocuments({
      recipient: userId,
      isRead: false,
    });

    // Get filtered unread count
    const filteredUnreadCount = await Notification.countDocuments({
      ...query,
      isRead: false,
    });

    res.status(200).json({ 
      data: items, 
      unreadCount,
      filteredUnreadCount,
      filter: filter || 'all'
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to load notifications" });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;
    const filter = req.query.filter; // 'mentions', 'messages', 'replies', 'comments', 'likes', 'all'

    const query = { 
      recipient: userId,
      isRead: false 
    };

    // Apply filter based on notification type and title patterns
    if (filter && filter !== 'all') {
      switch (filter) {
        case 'mentions':
          query.$or = [
            { title: { $regex: /mentioned you in a post/i } },
            { title: { $regex: /mentioned you in a comment/i } }
          ];
          break;
        case 'messages':
          query.type = 'message';
          break;
        case 'replies':
          query.$or = [
            { title: { $regex: /replied to your comment/i } },
            { title: { $regex: /commented on your post/i } }
          ];
          break;
        case 'comments':
          query.type = 'comment';
          break;
        case 'likes':
          query.$or = [
            { title: { $regex: /liked your post/i } },
            { title: { $regex: /liked your comment/i } }
          ];
          break;
      }
    }

    const unread = await Notification.countDocuments(query);
    res.status(200).json({ unread, filter: filter || 'all' });
  } catch (err) {
    res.status(500).json({ message: "Failed to get unread count" });
  }
};

export const markRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const result = await Notification.updateOne(
      { _id: id, recipient: userId },
      { $set: { isRead: true } }
    );
    // Emit updated unread count
    const unread = await Notification.countDocuments({
      recipient: userId,
      isRead: false,
    });
    const io = getIo?.();
    if (io) io.to(String(userId)).emit("notifications_unread", { unread });
    res.status(200).json({ updated: result.modifiedCount, unread });
  } catch (err) {
    res.status(500).json({ message: "Failed to mark read" });
  }
};

export const markAllRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const result = await Notification.updateMany(
      { recipient: userId, isRead: false },
      { $set: { isRead: true } }
    );
    // Emit updated unread count (should be 0)
    const unread = await Notification.countDocuments({
      recipient: userId,
      isRead: false,
    });
    const io = getIo?.();
    if (io) io.to(String(userId)).emit("notifications_unread", { unread });
    res.status(200).json({ updated: result.modifiedCount, unread });
  } catch (err) {
    res.status(500).json({ message: "Failed to mark all read" });
  }
};



