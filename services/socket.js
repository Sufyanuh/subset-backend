// sockets.js
import { Server } from "socket.io";
import { User } from "../model/user.js";
import { Conversation } from "../model/conversation.js";
import { Message } from "../model/chatMessage.js";
import { Notification } from "../model/notification.js";
import { buildConversationId } from "./buildConversationId.js"; // must sort ids consistently
import { verifyToken } from "./generateJwt.js";

let ioRef = null;

export function getIo() {
  return ioRef;
}

export function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    path: "/socket.io/",
  });
  ioRef = io;
  // Auth via handshake token
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake?.auth?.token;
      if (!token) return next(new Error("no_token"));
      const data = await verifyToken(token, "user");

      // IMPORTANT: findOne (array from find() breaks socket.user)
      const user = await User.findById(data._id)
        .select("_id username fullName avatar")
        .lean();

      if (!user) return next(new Error("user_not_found"));
      socket.user = user;
      next();
    } catch {
      next(new Error("auth_failed"));
    }
  });

  io.on("connection", (socket) => {
    if (!socket.user?._id) {
      socket.emit("connected", { error: "not_authenticated" });
      return socket.disconnect(true);
    }

    const selfId = String(socket.user._id);
    socket.join(selfId);
    socket.emit("connected", { userId: socket.user._id });

    // Presence tracking removed

    // Send a private message
    socket.on("private_message", async (payload, callback) => {
      try {
        const { recipientId, text, media } = payload || {};
        if (
          !recipientId ||
          (!text && !(Array.isArray(media) && media.length))
        ) {
          return callback?.({ ok: false, error: "invalid_payload" });
        }
        const recipientIdStr = String(recipientId);
        const conversationId = buildConversationId(selfId, recipientIdStr);

        const now = new Date();
        const message = await Message.create({
          conversationId,
          sender: selfId,
          recipient: recipientIdStr,
          text: text || "",
          media: media || [],
          createdAt: now,
          deliveredAt: now,
        });

        // Upsert conversation + increment unread for recipient (no conflicts)
        const [userA, userB] = [selfId, recipientIdStr].sort();
        const unreadIncField =
          recipientIdStr === userA ? "unreadForA" : "unreadForB";

        const convUpdate = await Conversation.findOneAndUpdate(
          { conversationId },
          {
            $setOnInsert: { userA, userB },
            $set: {
              lastMessageId: message._id,
              lastMessageAt: message.createdAt,
            },
            $inc: { [unreadIncField]: 1 },
          },
          { upsert: true, new: true }
        ).lean();

        const [sender, recipient] = await Promise.all([
          User.findById(selfId).select("username fullName avatar").lean(),
          User.findById(recipientIdStr)
            .select("username fullName avatar")
            .lean(),
        ]);

        const event = {
          ...message.toObject(),
          id: String(message._id),
          sender,
          recipient,
        };

        // Deliver to recipient and echo to sender
        io.to(recipientIdStr).emit("message", event);
        socket.emit("message", event);

        // Inbox updates
        const unreadForRecipient =
          recipientIdStr === convUpdate.userA
            ? convUpdate.unreadForA
            : convUpdate.unreadForB;

        const hasPrevious = await Message.exists({
          conversationId,
          _id: { $ne: message._id },
        });

        io.to(recipientIdStr).emit("inbox_update", {
          conversationId,
          counterpart: {
            _id: sender._id,
            username: sender.username,
            fullName: sender.fullName,
            avatar: sender.avatar,
          },
          lastMessage: event,
          unreadCount: unreadForRecipient || 0,
          timestamp: new Date(),
          isNewConversation: !hasPrevious,
        });

        const unreadForSender =
          selfId === convUpdate.userA
            ? convUpdate.unreadForA
            : convUpdate.unreadForB;

        socket.emit("inbox_update", {
          conversationId,
          counterpart: {
            _id: recipient._id,
            username: recipient.username,
            fullName: recipient.fullName,
            avatar: recipient.avatar,
          },
          lastMessage: event,
          unreadCount: unreadForSender || 0,
          timestamp: new Date(),
          isNewConversation: !hasPrevious,
        });

        // Persist a notification for recipient
        if (String(recipient._id) !== String(sender._id)) {
          const notification = await Notification.create({
            type: "message",
            actor: sender._id,
            recipient: recipient._id,
            message: message._id,
            conversationId,
            title: `${sender.username} sent you a message`,
            body: text ? String(text).slice(0, 140) : "Sent an attachment",
          });
          io.to(recipientIdStr).emit("notification", {
            ...notification.toObject(),
          });
        }

        callback?.({ ok: true, id: String(message._id) });
      } catch (err) {
        callback?.({ ok: false, error: "send_failed", err });
      }
    });

    // Mark conversation as read
    socket.on("mark_read", async (payload, callback) => {
      try {
        const { userId } = payload || {};
        if (!userId) return callback?.({ ok: false, error: "invalid_payload" });

        const otherId = String(userId);
        const conversationId = buildConversationId(selfId, otherId);
        const updatedAt = new Date();

        const result = await Message.updateMany(
          { conversationId, recipient: selfId, readAt: { $exists: false } },
          { $set: { readAt: updatedAt } }
        );

        // Reset unread for reader
        const [userA, userB] = [selfId, otherId].sort();
        const resetField = selfId === userA ? "unreadForA" : "unreadForB";
        await Conversation.findOneAndUpdate(
          { conversationId },
          { $set: { [resetField]: 0 } },
          { new: true }
        );
        await Notification.updateMany(
          {
            conversationId,
            recipient: selfId,
            isRead: false,
          },
          {
            $set: { isRead: true },
          }
        );
        const unread = await Notification.countDocuments({
          recipient: userId,
          isRead: false,
        });
        if (io) io.to(String(userId)).emit("notifications_unread", { unread });
        // Notify counterpart
        io.to(otherId).emit("read_receipt", {
          conversationId,
          by: selfId,
          at: updatedAt,
        });

        // Inbox updates
        io.to(otherId).emit("inbox_update", {
          conversationId,
          counterpart: { _id: selfId },
          unreadCount: undefined,
          timestamp: new Date(),
          readBy: selfId,
        });

        socket.emit("inbox_update", {
          conversationId,
          counterpart: { _id: otherId },
          unreadCount: 0,
          timestamp: new Date(),
          readBy: selfId,
        });

        callback?.({ ok: true, updated: result.modifiedCount });
      } catch (err) {
        callback?.({ ok: false, error: "read_failed" });
      }
    });

    // Edit a message
    socket.on("edit_message", async (payload, callback) => {
      try {
        const { messageId, text, media } = payload || {};
        if (!messageId || typeof text !== "string") {
          return callback?.({ ok: false, error: "invalid_payload" });
        }

        const original = await Message.findById(messageId);
        if (!original)
          return callback?.({ ok: false, error: "message_not_found" });
        if (String(original.sender) !== selfId) {
          return callback?.({ ok: false, error: "unauthorized" });
        }

        const updatedMessage = await Message.findByIdAndUpdate(
          messageId,
          {
            text,
            media: Array.isArray(media) ? media : original.media,
            editedAt: new Date(),
          },
          { new: true }
        )
          .populate("sender", "username fullName avatar")
          .populate("recipient", "username fullName avatar");

        const event = {
          ...updatedMessage.toObject(),
          id: String(updatedMessage._id),
        };

        const recipientId = String(original.recipient);
        io.to(recipientId).emit("message_edited", event);
        socket.emit("message_edited", event);

        const conv = await Conversation.findOne({
          conversationId: original.conversationId,
        }).lean();
        if (conv && String(conv.lastMessageId) === String(updatedMessage._id)) {
          const inboxUpdate = {
            conversationId: original.conversationId,
            counterpart: { _id: recipientId },
            lastMessage: event,
            timestamp: new Date(),
            isEdited: true,
          };
          io.to(recipientId).emit("inbox_update", inboxUpdate);
          socket.emit("inbox_update", inboxUpdate);
        }

        callback?.({ ok: true, message: event });
      } catch (err) {
        callback?.({ ok: false, error: "edit_failed" });
      }
    });

    // Delete a message
    socket.on("delete_message", async (payload, callback) => {
      try {
        const { messageId } = payload || {};
        if (!messageId)
          return callback?.({ ok: false, error: "invalid_payload" });

        const message = await Message.findById(messageId);
        if (!message)
          return callback?.({ ok: false, error: "message_not_found" });
        if (String(message.sender) !== selfId) {
          return callback?.({ ok: false, error: "unauthorized" });
        }

        const { conversationId } = message;
        const recipientId = String(message.recipient);

        await Message.findByIdAndDelete(messageId);

        // If it was last message, compute new last
        const conv = await Conversation.findOne({ conversationId });
        if (conv && String(conv.lastMessageId) === String(message._id)) {
          const prev = await Message.find({ conversationId })
            .sort({ createdAt: -1 })
            .limit(1);
          const prevMsg = prev[0] || null;

          await Conversation.updateOne(
            { conversationId },
            {
              $set: {
                lastMessageId: prevMsg ? prevMsg._id : null,
                lastMessageAt: prevMsg ? prevMsg.createdAt : null,
              },
            }
          );

          const [sender, recipient, prevPopulated] = await Promise.all([
            User.findById(selfId).select("username fullName avatar").lean(),
            User.findById(recipientId)
              .select("username fullName avatar")
              .lean(),
            prevMsg
              ? Message.findById(prevMsg._id)
                  .populate("sender", "username fullName avatar")
                  .populate("recipient", "username fullName avatar")
              : null,
          ]);

          const inboxUpdate = {
            conversationId,
            counterpart: {
              _id: recipient._id,
              username: recipient.username,
              fullName: recipient.fullName,
              avatar: recipient.avatar,
            },
            lastMessage: prevPopulated
              ? { ...prevPopulated.toObject(), id: String(prevPopulated._id) }
              : null,
            timestamp: new Date(),
            isDeleted: true,
          };
          io.to(recipientId).emit("inbox_update", inboxUpdate);
          socket.emit("inbox_update", {
            ...inboxUpdate,
            counterpart: {
              _id: sender._id,
              username: sender.username,
              fullName: sender.fullName,
              avatar: sender.avatar,
            },
          });
        }

        const event = { messageId: String(message._id), conversationId };
        io.to(recipientId).emit("message_deleted", event);
        socket.emit("message_deleted", event);

        callback?.({ ok: true, messageId: String(message._id) });
      } catch (err) {
        callback?.({ ok: false, error: "delete_failed" });
      }
    });

    socket.on("disconnect", () => {});
  });

  return io;
}
