import mongoose from "mongoose";
import Comment from "../../model/comment.js";
import { Notification } from "../../model/notification.js";
import Post from "../../model/post.js";
import { SubChannels } from "../../model/subChannels.js";
import { deleteFromS3 } from "../../services/deleteFromS3.js";
import { getIo } from "../../services/socket.js";
import { extractMentions } from "../../utils/extractMentions.js";
import { sendEmail } from "../../utils/sendEmail.js";
import { logger } from "../../utils/logger.js";

export const createPost = async (req, res) => {
  try {
    const data = req.body;
    const { _id } = req.user;
    const userId = _id;

    const isPostValid = data?.title || data?.media?.length > 0;
    if (!isPostValid) {
      return res.status(400).json({
        success: false,
        message: "Post must have a title or media",
      });
    }

    if (!data?.channelId) {
      return res.status(400).json({
        success: false,
        message: "Channel ID is required",
      });
    }

    // Verify channel exists
    const channel = await SubChannels.findById(data?.channelId);
    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    // Extract mentions - returns user IDs (all users for @everyone)
    const mentionedUserIds = await extractMentions(data?.title || "");
    console.log(
      mentionedUserIds,
      "<======mentionedUserIds",
      "Total:",
      mentionedUserIds?.length || 0,
    );

    // Create post
    const newPost = new Post({
      title: data?.title,
      links: data?.links,
      channel: data?.channelId,
      channelName: channel.name,
      author: userId,
      authorName: req.user.username,
      authorAvatar: req.user.avatar,
      media: data?.media || [],
      mentions: mentionedUserIds,
      isEmbed: data.isEmbed,
    });

    // Save post (this happens instantly)
    const savedPost = await newPost.save();

    // Populate author for immediate response
    const populatedPost = await Post.findById(savedPost._id)
      .populate("author", "username avatar fullName isAdmin")
      .populate("mentions", "username avatar isAdmin") // Populate mentions if needed
      .lean();

    // 🚀 **SOCKET EMIT FOR POST CREATION**
    const io = getIo?.();
    if (io) {
      // Emit to everyone in the channel or globally
      io.emit("post_created", {
        success: true,
        message: "New post created",
        data: populatedPost,
      });

      // Alternatively, emit to specific channel
      // io.to(`channel:${data.channelId}`).emit("post_created", {
      //   success: true,
      //   message: "New post created in channel",
      //   data: populatedPost,
      // });
    }

    // 🚀 **CRITICAL: SEND RESPONSE IMMEDIATELY**
    res.status(201).json({
      success: true,
      message: "Post created successfully",
      data: populatedPost,
    });

    // 🔥 **BACKGROUND PROCESSING for notifications**
    processNotificationsInBackground({
      postId: savedPost._id,
      authorId: userId,
      authorName: req.user.username,
      title: savedPost.title,
      mentionedUserIds: mentionedUserIds,
      channelName: channel.name,
      channelId: data.channelId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

// 🔥 OPTIMIZED BACKGROUND PROCESSING FUNCTION
async function processNotificationsInBackground({
  postId,
  authorId,
  authorName,
  title,
  mentionedUserIds,
  channelName,
  channelId,
}) {
  try {
    // Small delay to ensure response is sent first
    await new Promise((resolve) => setTimeout(resolve, 100));

    const io = getIo?.();
    if (!io || mentionedUserIds.length === 0) return;

    // Filter out author from recipients
    const recipients = mentionedUserIds.filter(
      (id) => String(id) !== String(authorId),
    );

    if (recipients.length === 0) return;

    console.log(`Processing notifications for ${recipients.length} recipients`);

    // Check if it's @everyone (large number of recipients)
    const isEveryoneMentioned = recipients.length > 100; // Adjust threshold as needed

    // For large number of recipients (@everyone case), use optimized approach
    if (recipients.length > 50) {
      await processLargeNotificationBatch({
        io,
        postId,
        authorId,
        authorName,
        title,
        recipients,
        channelName,
        channelId,
        isEveryone: isEveryoneMentioned,
      });
    } else {
      // Process small batches normally
      await processSmallNotificationBatch({
        io,
        postId,
        authorId,
        authorName,
        title,
        recipients,
        channelName,
        channelId,
        isEveryone: isEveryoneMentioned,
      });
    }

    console.log(
      `Background notifications processed for ${recipients.length} users`,
    );
  } catch (error) {
    console.error("Background notification error:", error);
  }
}

async function processSmallNotificationBatch({
  io,
  postId,
  authorId,
  authorName,
  title,
  recipients,
  channelName,
  channelId,
  isEveryone,
}) {
  const notificationPromises = recipients.map(async (recipientId) => {
    const notif = await Notification.create({
      type: "post",
      actor: authorId,
      recipient: recipientId,
      post: postId,
      title: isEveryone
        ? `${authorName} mentioned everyone in #${channelName}`
        : `${authorName} mentioned you in a post`,
      body: title ? String(title).slice(0, 140) : "",
      channel: channelId,
    });

    // Send notification via socket
    io.to(String(recipientId)).emit("notification", {
      ...notif.toObject(),
    });

    // Update unread count
    const unread = await Notification.countDocuments({
      recipient: recipientId,
      isRead: false,
    });
    io.to(String(recipientId)).emit("notifications_unread", { unread });
  });

  // Process in batches of 10
  const BATCH_SIZE = 10;
  for (let i = 0; i < notificationPromises.length; i += BATCH_SIZE) {
    const batch = notificationPromises.slice(i, i + BATCH_SIZE);
    await Promise.all(batch);
  }
}

async function processLargeNotificationBatch({
  io,
  postId,
  authorId,
  authorName,
  title,
  recipients,
  channelName,
  channelId,
  isEveryone,
}) {
  // Bulk create notifications
  const notificationDocs = recipients.map((recipientId) => ({
    type: "post",
    actor: authorId,
    recipient: recipientId,
    post: postId,
    title: isEveryone
      ? `${authorName} mentioned everyone in #${channelName}`
      : `${authorName} mentioned you in a post`,
    body: title ? String(title).slice(0, 140) : "",
    channel: channelId,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  // Insert all notifications in one go
  const insertedNotifications = await Notification.insertMany(notificationDocs);

  console.log(`Bulk inserted ${insertedNotifications.length} notifications`);

  // Send socket notifications in chunks to avoid overwhelming
  const CHUNK_SIZE = 50;
  for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
    const chunkRecipients = recipients.slice(i, i + CHUNK_SIZE);
    const chunkNotifications = insertedNotifications.slice(i, i + CHUNK_SIZE);

    // Send to each user in chunk
    chunkRecipients.forEach((recipientId, idx) => {
      if (chunkNotifications[idx]) {
        io.to(String(recipientId)).emit("notification", {
          ...chunkNotifications[idx].toObject(),
        });
      }
    });

    // Update unread counts for chunk (can be optimized further)
    await Promise.all(
      chunkRecipients.map(async (recipientId) => {
        const unread = await Notification.countDocuments({
          recipient: recipientId,
          isRead: false,
        });
        io.to(String(recipientId)).emit("notifications_unread", { unread });
      }),
    );

    // Small delay between chunks
    if (i + CHUNK_SIZE < recipients.length) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
export const getPostsByChannelId = async (req, res) => {
  try {
    const { channelId } = req.params;
    const { isPaid, isAdmin, _id: currentUserId } = req.user;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Verify channel exists
    const channel = await SubChannels.findById(channelId);
    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    if (channel.isPaid && !isPaid) {
      return res.status(403).json({
        success: false,
        message: "Access denied. This is a paid channel.",
      });
    }

    // Build query
    const query = {
      channel: channelId,
    };

    // Step 1: Get posts with author populated
    const posts = await Post.find(query)
      .sort({ isPinned: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("author")
      .populate("likes.user")
      .lean();

    for (const post of posts) {
      // Step 4: Get comments for each post
      post.comments = await Comment.find({
        post: post._id,
        parentComment: null,
      })
        .sort({ createdAt: -1 })
        .populate("author")
        .populate({
          path: "replies",
          options: { sort: { createdAt: 1 } },
          populate: {
            path: "author",
            select: "username avatar",
          },
        })
        .lean();

      // Step 5: Add isLiked for comments
      if (currentUserId) {
        for (const comment of post.comments) {
          comment.isLiked =
            comment.likes &&
            comment.likes.some(
              (like) =>
                like.user && like.user.toString() === currentUserId.toString(),
            );

          // Add isLiked for replies
          if (comment.replies) {
            for (const reply of comment.replies) {
              reply.isLiked =
                reply.likes &&
                reply.likes.some(
                  (like) =>
                    like.user &&
                    like.user.toString() === currentUserId.toString(),
                );
            }
          }
        }
      }
    }

    // Get total count for pagination info
    const totalPosts = await Post.countDocuments(query);

    res.status(200).json({
      success: true,
      data: posts, // Already processed
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalPosts / limit),
        totalPosts,
        postsPerPage: limit,
      },
      channelInfo: {
        name: channel.name,
        description: channel.description,
        memberCount: channel.memberCount,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const getPostById = async (req, res) => {
  try {
    const { postId } = req.params;
    const currentUserId = req?.user?.currentUserId;

    // Step 1: Find post with author populated
    const post = await Post.findById(postId)
      .populate("author")
      .populate("likes.user")
      .lean();

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
      });
    }

    if (currentUserId) {
      post.isLiked = post.likes.some((like) => {
        if (!like.user) return false;
        if (typeof like.user === "object" && like.user._id) {
          return like.user._id.toString() === currentUserId.toString();
        }
        return like.user.toString() === currentUserId.toString();
      });
    } else {
      post.isLiked = false;
    }

    post.comments = await Comment.find({
      post: postId,
      parentComment: null,
    })
      .sort({ createdAt: -1 })
      .populate("author", "username avatar")
      .populate({
        path: "replies",
        options: { sort: { createdAt: 1 } },
        populate: {
          path: "author",
        },
      })
      .lean();

    if (currentUserId) {
      for (const comment of post.comments) {
        comment.isLiked =
          comment.likes &&
          comment.likes.some(
            (like) =>
              like.user && like.user.toString() === currentUserId.toString(),
          );

        if (comment.replies) {
          for (const reply of comment.replies) {
            reply.isLiked =
              reply.likes &&
              reply.likes.some(
                (like) =>
                  like.user &&
                  like.user.toString() === currentUserId.toString(),
              );
          }
        }
      }
    } else {
      for (const comment of post.comments) {
        comment.isLiked = false;
        if (comment.replies) {
          for (const reply of comment.replies) {
            reply.isLiked = false;
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      data: post,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id;
    const isAdmin = req.user.isAdmin;

    let post;

    // If admin → delete any post
    if (isAdmin) {
      post = await Post.findOneAndDelete({ _id: postId });
    } else {
      // Normal user → can only delete own post
      post = await Post.findOneAndDelete({ _id: postId, author: userId });
    }

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found or you do not have permission to delete it",
      });
    }

    // delete comments
    await Comment.deleteMany({ post: postId });

    // delete media from S3
    if (post?.media?.length > 0) {
      post.media.forEach((media) => {
        deleteFromS3(media.url);
      });
    }

    // Emit realtime event
    const io = getIo?.();
    if (io) {
      io.emit("post_deleted", {
        success: true,
        message: `Post deleted successfully ${isAdmin ? `by Admin` : ""}`,
        data: {
          postId: String(post._id),
          channelId: String(post.channel),
          authorId: String(post.author),
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Post deleted successfully",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const updatePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const data = req.body;
    const { _id, isAdmin, username } = req.user;
    const userId = _id;

    // Find the post
    const existingPost = await Post.findById(postId);
    if (!existingPost) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
      });
    }

    // Check if user is the author
    if (String(existingPost.author) !== String(userId) && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own posts",
      });
    }

    // Validate post data
    const isPostValid =
      data?.title || data?.media?.length > 0 || data?.links?.length > 0;
    if (!isPostValid) {
      return res.status(400).json({
        success: false,
        message: "Post must have a title, media, or links",
      });
    }

    // Check if channel is being changed
    if (data?.channelId && data.channelId !== String(existingPost.channel)) {
      const channel = await SubChannels.findById(data.channelId);
      if (!channel) {
        return res.status(404).json({
          success: false,
          message: "Channel not found",
        });
      }
      existingPost.channel = data.channelId;
      existingPost.channelName = channel.name;
    }

    // Store old mentions before update
    const oldMentions = existingPost.mentions || [];

    // Extract mentions from new title
    const mentionedUserIds = await extractMentions(data?.title || "");
    console.log(
      "New mentions:",
      mentionedUserIds,
      "Old mentions:",
      oldMentions,
    );

    // Find NEW mentions (users who weren't mentioned before)
    const newMentions = mentionedUserIds.filter(
      (mentionedUserId) =>
        !oldMentions.some(
          (oldMention) => String(oldMention) === String(mentionedUserId),
        ) && String(mentionedUserId) !== String(userId), // Skip self-mention
    );

    console.log("New mentions after update:", newMentions);

    // Update post fields
    if (data?.title !== undefined) {
      existingPost.title = data.title;
    }

    if (data?.media !== undefined) {
      existingPost.media = data.media;
    }

    if (data?.links !== undefined) {
      existingPost.links = data.links;
    }

    // Update mentions
    existingPost.mentions = mentionedUserIds;

    // Update timestamps
    existingPost.updatedAt = Date.now();

    // Save the updated post
    const updatedPost = await existingPost.save();

    // Populate author for immediate response
    const populatedPost = await Post.findById(updatedPost._id)
      .populate("author", "username avatar fullName")
      .populate("channel", "name description memberCount")
      .populate("likes", "user username timestamp")
      .lean();

    // 🚀 **SOCKET EMIT FOR POST UPDATE**
    const io = getIo?.();
    if (io) {
      // Emit to all connected clients
      io.emit("post_updated", {
        success: true,
        message: "Post updated successfully",
        data: populatedPost,
      });
    }

    // 🚀 **CRITICAL: SEND RESPONSE IMMEDIATELY**
    res.status(200).json({
      success: true,
      message: "Post updated successfully",
      data: populatedPost,
    });

    // 🔥 **BACKGROUND PROCESSING for NEW mentions**
    if (newMentions.length > 0) {
      processUpdateNotificationsInBackground({
        postId: updatedPost._id,
        authorId: userId,
        authorName: username,
        title: updatedPost.title,
        newMentions: newMentions,
        channelName: existingPost.channelName,
      });
    }
  } catch (err) {
    console.error("Error updating post:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

// 🔥 BACKGROUND PROCESSING FOR UPDATE NOTIFICATIONS
async function processUpdateNotificationsInBackground({
  postId,
  authorId,
  authorName,
  title,
  newMentions,
  channelName,
}) {
  try {
    // Small delay to ensure response is sent first
    await new Promise((resolve) => setTimeout(resolve, 100));

    const io = getIo?.();
    if (!io || newMentions.length === 0) return;

    console.log(
      `Processing update notifications for ${newMentions.length} new mentions`,
    );

    // Filter out author (just in case)
    const recipients = newMentions.filter(
      (id) => String(id) !== String(authorId),
    );

    if (recipients.length === 0) return;

    // Check if it's @everyone (large number of new mentions)
    const isEveryoneMentioned = recipients.length > 100; // Adjust threshold

    // For large batches, use optimized approach
    if (recipients.length > 50) {
      await processLargeUpdateNotificationBatch({
        io,
        postId,
        authorId,
        authorName,
        title,
        recipients,
        channelName,
        isEveryone: isEveryoneMentioned,
      });
    } else {
      // Process small batches normally
      await processSmallUpdateNotificationBatch({
        io,
        postId,
        authorId,
        authorName,
        title,
        recipients,
        channelName,
        isEveryone: isEveryoneMentioned,
      });
    }

    console.log(
      `Update notifications processed for ${recipients.length} users`,
    );
  } catch (error) {
    console.error("Background update notification error:", error);
  }
}

// Process small batches for updates
async function processSmallUpdateNotificationBatch({
  io,
  postId,
  authorId,
  authorName,
  title,
  recipients,
  channelName,
  isEveryone,
}) {
  const notificationPromises = recipients.map(async (recipientId) => {
    // Check if notification already exists for this post and user
    const existingNotification = await Notification.findOne({
      type: "post",
      actor: authorId,
      recipient: recipientId,
      post: postId,
    });

    // Only create new notification if one doesn't exist
    if (!existingNotification) {
      const notif = await Notification.create({
        type: "post",
        actor: authorId,
        recipient: recipientId,
        post: postId,
        title: isEveryone
          ? `${authorName} mentioned everyone in #${channelName} (updated post)`
          : `${authorName} mentioned you in a post (updated)`,
        body: title ? String(title).slice(0, 140) : "",
      });

      // Send notification via socket
      io.to(String(recipientId)).emit("notification", {
        ...notif.toObject(),
      });

      // Update unread count
      const unread = await Notification.countDocuments({
        recipient: recipientId,
        isRead: false,
      });
      io.to(String(recipientId)).emit("notifications_unread", { unread });
    }
  });

  // Process in batches of 10
  const BATCH_SIZE = 10;
  for (let i = 0; i < notificationPromises.length; i += BATCH_SIZE) {
    const batch = notificationPromises.slice(i, i + BATCH_SIZE);
    await Promise.all(batch);
  }
}

// Optimized processing for @everyone/large batches in updates
async function processLargeUpdateNotificationBatch({
  io,
  postId,
  authorId,
  authorName,
  title,
  recipients,
  channelName,
  isEveryone,
}) {
  try {
    // First, check which users already have notifications
    const existingNotifications = await Notification.find({
      type: "post",
      actor: authorId,
      post: postId,
      recipient: { $in: recipients },
    })
      .select("recipient")
      .lean();

    const existingRecipientIds = existingNotifications.map((n) =>
      String(n.recipient),
    );

    // Filter out users who already have notifications
    const newRecipients = recipients.filter(
      (recipientId) => !existingRecipientIds.includes(String(recipientId)),
    );

    console.log(
      `Filtered: ${newRecipients.length} new recipients out of ${recipients.length} total`,
    );

    if (newRecipients.length === 0) return;

    // Bulk create notifications for new recipients
    const notificationDocs = newRecipients.map((recipientId) => ({
      type: "post",
      actor: authorId,
      recipient: recipientId,
      post: postId,
      title: isEveryone
        ? `${authorName} mentioned everyone in #${channelName} (updated post)`
        : `${authorName} mentioned you in a post (updated)`,
      body: title ? String(title).slice(0, 140) : "",
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    // Insert all notifications in one go
    const insertedNotifications =
      await Notification.insertMany(notificationDocs);

    console.log(
      `Bulk inserted ${insertedNotifications.length} update notifications`,
    );

    // Send socket notifications in chunks
    const CHUNK_SIZE = 50;
    for (let i = 0; i < newRecipients.length; i += CHUNK_SIZE) {
      const chunkRecipients = newRecipients.slice(i, i + CHUNK_SIZE);
      const chunkNotifications = insertedNotifications.slice(i, i + CHUNK_SIZE);

      // Send to each user in chunk
      chunkRecipients.forEach((recipientId, idx) => {
        if (chunkNotifications[idx]) {
          io.to(String(recipientId)).emit("notification", {
            ...chunkNotifications[idx].toObject(),
          });
        }
      });

      // Update unread counts for chunk
      await Promise.all(
        chunkRecipients.map(async (recipientId) => {
          const unread = await Notification.countDocuments({
            recipient: recipientId,
            isRead: false,
          });
          io.to(String(recipientId)).emit("notifications_unread", { unread });
        }),
      );

      // Small delay between chunks
      if (i + CHUNK_SIZE < newRecipients.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  } catch (error) {
    console.error("Error in large update notification batch:", error);
  }
}

// Post Like Controller
export const likeDislikePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id;
    const username = req.user.username;
    const avatar = req.user.avatar;
    // Validate post exists
    const post = await Post.findById(postId).populate("likes.user");
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
      });
    }

    // Check if user already liked the post
    const existingLikeIndex = post.likes.findIndex(
      (like) => like.user && like.user._id.toString() === userId.toString(),
    );

    let action;

    if (existingLikeIndex === -1) {
      // Add like
      post.likes.push({
        user: {
          _id: userId,
          username: username,
          avatar: avatar,
        },
        timestamp: new Date(),
      });
      action = "liked";
    } else {
      // Remove like
      post.likes.splice(existingLikeIndex, 1);
      action = "unliked";
    }

    // Update like count
    post.likeCount = post.likes.length;
    // Emit like update to all users
    const io = getIo?.();
    if (io) {
      io.emit("post_like_updated", {
        success: true,
        message: `Post ${action} successfully`,
        data: {
          ...post.toObject(),
        },
      });
    }
    // Save the updated post
    const updatedPost = await post.save();

    // Notify post author on like (skip if unliked or self-like)
    if (action === "liked") {
      const postAuthorId = String(post.author);
      const actorId = String(userId);
      if (postAuthorId !== actorId) {
        const notif = await Notification.create({
          type: "post",
          actor: actorId,
          recipient: postAuthorId,
          post: post._id,
          title: `${username} liked your post`,
          body: post.title ? String(post.title).slice(0, 140) : "",
        });
        const io = getIo?.();
        if (io) {
          io.to(postAuthorId).emit("notification", {
            ...notif.toObject(),
          });
          const unread = await Notification.countDocuments({
            recipient: postAuthorId,
            isRead: false,
          });
          io.to(postAuthorId).emit("notifications_unread", { unread });
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Post ${action} successfully`,
      data: {
        likeCount: updatedPost.likeCount,
        isLiked: action === "liked",
        postId: postId,
        post,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const toggleCommenting = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id;
    const username = req.user.username;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
      });
    }
    post.isCommentingEnabled = !post.isCommentingEnabled;
    await post.save();
    const io = getIo?.();
    if (io) {
      io.emit("post_comment_toggle", {
        success: true,
        message: `Comment ${
          post.isCommentingEnabled ? "Off" : "On"
        }  successfully`,
        data: {
          ...post.toObject(),
        },
      });
    }
    res.status(200).json({
      success: true,
      message: "Commenting enabled/disabled successfully",
      data: post,
    });
  } catch (err) {
    console.error(err);
  }
};

export const togglePinned = async (req, res) => {
  try {
    const { postId } = req.params;
    const isAdmin = req.user.isAdmin;
    if (!isAdmin) {
      return res.status(401).json({
        success: false,
        message: "You are not authorized to pin posts",
      });
    }
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
      });
    }
    post.isPinned = !post.isPinned;
    await post.save();
    const io = getIo?.();
    if (io) {
      io.emit("post_pin_toggle", {
        success: true,
        message: `Post ${post.isPinned ? "Pinned" : "UnPinned"}  successfully`,
        data: {
          ...post.toObject(),
        },
      });
    }
    res.status(200).json({
      success: true,
      message: "Post pinned/unpinned successfully",
      data: post,
    });
  } catch (err) {
    console.error(err);
  }
};

export const ReportPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { message } = req.body;

    const post = await Post.findById(postId).populate("author", "name email");

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
      });
    }

    const user = req.user;

    const redirectURL = `https://newuser.thesubset.org/connect/post/${postId}`;

    /* ---------------------------------------------------------
        ADMIN EMAIL TEMPLATE
    --------------------------------------------------------- */
    const adminEmailContent = `
      <div style="max-width:600px;margin:auto;padding:20px;font-family:Arial;background:#fff;border:1px solid #eee;border-radius:10px;">
        
        <h2 style="text-align:center;color:#000;">🚨 New Post Report Received</h2>

        <p style="font-size:15px;color:#333;">
          A user has reported a post. Details are below:
        </p>

        <div style="margin:20px 0;padding:15px;background:#f7f7f7;border-radius:8px;">
          <p><strong>Reporter Name:</strong> ${user.username}</p>
          <p><strong>Reporter Email:</strong> ${user.email}</p>
          <p><strong>Reason:</strong> ${message}</p>
        </div>

        <h3 style="color:#000;">📌 Reported Post Details</h3>
        <div style="margin:15px 0;padding:15px;background:#fafafa;border-radius:8px;">
          <p><strong>Post Title:</strong> ${post.title}</p>
          <p><strong>Author:</strong> ${post.authorName}</p>
          <p><strong>Channel:</strong> ${post.channelName}</p>
        </div>

        <div style="text-align:center;margin-top:25px;">
          <a href="${redirectURL}" 
            style="background:#000;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block;">
            View Reported Post
          </a>
        </div>

        <p style="text-align:center;margin-top:20px;color:#888;font-size:12px;">
          © ${new Date().getFullYear()} The Subset. All Rights Reserved.
        </p>
      </div>
    `;

    /* ---------------------------------------------------------
        USER EMAIL TEMPLATE
    --------------------------------------------------------- */
    const userEmailContent = `
      <div style="max-width:600px;margin:auto;padding:20px;background:#fff;font-family:Arial;border-radius:10px;border:1px solid #eee;">
        
        <h2 style="text-align:center;color:#000;">Thank You! 🙌</h2>

        <p style="font-size:15px;color:#444;text-align:center;">
          We have received your report regarding a post on The Subset.  
          Our moderation team will review it shortly.
        </p>

        <div style="margin:20px auto;padding:15px;border-radius:8px;background:#fafafa;">
          <p><strong>Your Message:</strong> ${message}</p>
        </div>

        <div style="text-align:center;margin-top:25px;">
          <a href="https://newuser.thesubset.org"
            style="background:#000;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block;">
            Visit The Subset
          </a>
        </div>

        <p style="text-align:center;margin-top:20px;color:#888;font-size:12px;">
          © ${new Date().getFullYear()} The Subset. All Rights Reserved.
        </p>
      </div>
    `;

    /* ---------------------------------------------------------
        SEND EMAILS
    --------------------------------------------------------- */
    await sendEmail(
      "contact@thesubset.org",
      "🚨 New Post Report Received",
      adminEmailContent,
    );

    await sendEmail(
      user.email,
      "✅ Your report has been received",
      userEmailContent,
    );

    return res.json({
      success: true,
      message: "Report submitted successfully.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};
