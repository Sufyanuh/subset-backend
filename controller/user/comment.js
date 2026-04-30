import Comment from "../../model/comment.js";
import Post from "../../model/post.js";
import { Notification } from "../../model/notification.js";
import { getIo } from "../../services/socket.js";
import { deleteMediaFiles } from "../../utils/deleteMediaFiles.js";
import { extractMentions } from "../../utils/extractMentions.js";
import { deleteFromS3 } from "../../services/deleteFromS3.js";
import { sendEmail } from "../../utils/sendEmail.js";

export const createComment = async (req, res) => {
  try {
    const data = req.body;
    const userId = req.user._id;
    const isCommentValid = data?.content || data?.media?.length > 0;

    if (!data?.postId) {
      return res.status(400).json({
        success: false,
        message: "Post ID is required",
      });
    }
    if (!isCommentValid) {
      return res.status(400).json({
        success: false,
        message: "Comment must have content or media",
      });
    }

    // Verify post exists
    const post = await Post.findById(data?.postId);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
      });
    }

    // Verify parent comment exists if provided
    if (data?.parentCommentId) {
      const parentComment = await Comment.findById(data?.parentCommentId);
      if (!parentComment) {
        return res.status(404).json({
          success: false,
          message: "Parent comment not found",
        });
      }
    }

    // Extract mentions from content
    const mentionedUserIds = await extractMentions(data?.content || "");

    // Create comment
    const newComment = new Comment({
      content: data?.content,
      post: data?.postId,
      author: userId,
      authorName: req.user.username,
      authorAvatar: req.user.avatar,
      parentComment: data?.parentCommentId || null,
      media: data?.media || [],
      mentions: mentionedUserIds,
    });

    // Save comment
    const savedComment = await newComment.save();

    // Update post's comment count and add comment reference
    await Post.findByIdAndUpdate(data?.postId, {
      $push: { comments: savedComment._id },
      $inc: { commentCount: 1 },
    });

    // If this is a reply, update parent comment
    if (data?.parentCommentId) {
      await Comment.findByIdAndUpdate(data?.parentCommentId, {
        $push: { replies: savedComment._id },
      });
    }

    // Notify mentioned users
    if (mentionedUserIds.length > 0) {
      const io = getIo?.();
      if (io) {
        for (const mentionedUserId of mentionedUserIds) {
          // Skip self-mention
          if (String(mentionedUserId) === String(userId)) continue;

          const notif = await Notification.create({
            type: "comment",
            actor: userId,
            recipient: mentionedUserId,
            post: post._id,
            comment: savedComment._id,
            title: `${req.user.username} mentioned you in a comment`,
            body: savedComment.content
              ? String(savedComment.content).slice(0, 140)
              : "",
          });

          io.to(String(mentionedUserId)).emit("notification", {
            ...notif.toObject(),
          });

          const unread = await Notification.countDocuments({
            recipient: mentionedUserId,
            isRead: false,
          });
          io.to(String(mentionedUserId)).emit("notifications_unread", {
            unread,
          });
        }
      }
    }

    // Notify parent comment author if this is a reply
    if (data?.parentCommentId) {
      const parentComment = await Comment.findById(data.parentCommentId);
      if (parentComment) {
        const parentCommentAuthorId = String(parentComment.author);
        const actorId = String(userId);

        // Skip if replying to own comment
        if (parentCommentAuthorId !== actorId) {
          const notif = await Notification.create({
            type: "comment",
            actor: actorId,
            recipient: parentCommentAuthorId,
            post: post._id,
            comment: savedComment._id,
            title: `${req.user.username} replied to your comment`,
            body: savedComment.content
              ? String(savedComment.content).slice(0, 140)
              : "",
          });

          const io = getIo?.();
          if (io) {
            io.to(parentCommentAuthorId).emit("notification", {
              ...notif.toObject(),
            });

            const unread = await Notification.countDocuments({
              recipient: parentCommentAuthorId,
              isRead: false,
            });
            io.to(parentCommentAuthorId).emit("notifications_unread", {
              unread,
            });
          }
        }
      }
    }

    // Notify post author (skip if self-comment)
    const postAuthorId = String(post.author);
    const actorId = String(userId);
    if (postAuthorId !== actorId) {
      const notif = await Notification.create({
        type: "comment",
        actor: actorId,
        recipient: postAuthorId,
        post: post._id,
        comment: savedComment._id,
        title: `${req.user.username} commented on your post`,
        body: savedComment.content?.slice(0, 140) || "",
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

    // Emit comment creation to all users
    const io = getIo?.();
    if (io) {
      // Create comment object matching API response structure
      const commentWithLikes = {
        ...savedComment.toObject(),
      };

      io.emit("comment_created", {
        success: true,
        message: "Comment created successfully",
        data: commentWithLikes,
      });
    }

    res.status(201).json({
      success: true,
      message: "Comment created successfully",
      data: savedComment,
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

export const getPostComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Verify post exists and get the actual comment count from the post
    const post = await Post.findById(postId).select("commentCount title");
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
      });
    }

    // Get comments with pagination
    const comments = await Comment.find({
      post: postId,
      parentComment: null,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("author", "username avatar")
      .populate({
        path: "replies",
        options: { sort: { createdAt: 1 } },
        populate: {
          path: "author",
          select: "username avatar",
        },
      });

    // If authenticated, add like status
    if (req.user) {
      const userId = req.user.id;
      for (const comment of comments) {
        comment.isLiked = comment.likes.some(
          (like) => like.user && like.user.equals(userId),
        );
      }
    }

    res.status(200).json({
      success: true,
      data: comments,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(post.commentCount / limit),
        totalComments: post.commentCount,
        commentsPerPage: limit,
      },
      postInfo: {
        title: post.title,
        commentCount: post.commentCount,
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

export const deleteComment = async (req, res) => {
  try {
    const { commentId } = req.params;

    // Find the parent comment
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res
        .status(404)
        .json({ success: false, message: "Comment not found" });
    }

    // Ensure only the author can delete
    if (
      comment.author.toString() !== req.user._id.toString() &&
      !req.user.isAdmin
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Find all direct replies to this comment
    const replies = await Comment.find({ parentComment: commentId });
    const replyIds = replies.map((reply) => reply._id);

    // Delete media files of replies
    replies.forEach((reply) => deleteMediaFiles(reply.media));

    // Delete the replies
    await Comment.deleteMany({ _id: { $in: replyIds } });

    // Update the post: remove replies and the parent comment
    await Post.findByIdAndUpdate(comment.post, {
      $pull: { comments: { $in: [...replyIds, commentId] } },
      $inc: { commentCount: -(1 + replyIds.length) },
    });

    // Delete media files of the parent comment
    if (comment?.media?.length > 0) {
      comment?.media?.forEach((media) => {
        deleteFromS3(media.url);
      });
    }

    // Delete the parent comment
    await Comment.findByIdAndDelete(commentId);

    // Emit comment deletion to all users
    const io = getIo?.();
    if (io) {
      io.emit("comment_deleted", {
        success: true,
        message: "Comment and its replies (with media) deleted successfully",
        data: {
          ...comment.toObject(),
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Comment and its replies (with media) deleted successfully",
    });
  } catch (err) {
    console.error("❌ Error deleting comment:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const editComment = async (req, res) => {
  try {
    const { commentId, content, media = [] } = req.body;
    const { _id, username } = req.user;

    // Validate input
    if (!commentId || !content) {
      return res.status(400).json({
        success: false,
        message: "Comment ID and content are required",
      });
    }

    // Fetch the comment
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: "Comment not found",
      });
    }

    // Check if user is the author
    if (String(comment.author) !== String(_id)) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own comments",
      });
    }

    // Store old mentions before update
    const oldMentions = comment.mentions || [];

    // Extract mentions from new content (same as create comment)
    const mentionedUserIds = await extractMentions(content || "");

    // Find NEW mentions (users who weren't mentioned before)
    const newMentions = mentionedUserIds.filter(
      (mentionedUserId) =>
        !oldMentions.some(
          (oldMention) => String(oldMention) === String(mentionedUserId),
        ) && String(mentionedUserId) !== String(_id), // Skip self-mention
    );

    // Update comment fields
    comment.content = content;
    comment.media = media;
    comment.mentions = mentionedUserIds;
    comment.updatedAt = Date.now();

    const updatedComment = await comment.save();

    // Get the post for notifications
    const post = await Post.findById(comment.post);

    // Notify NEWLY mentioned users (prevent duplicate notifications)
    if (newMentions.length > 0) {
      const io = getIo?.();
      if (io) {
        for (const mentionedUserId of newMentions) {
          // Skip self-mention (already filtered above but double-check)
          if (String(mentionedUserId) === String(_id)) continue;

          // Check if notification already exists for this comment and user
          const existingNotification = await Notification.findOne({
            type: "comment",
            actor: _id,
            recipient: mentionedUserId,
            comment: updatedComment._id,
            post: post._id,
            isRead: false,
          });

          // Only create new notification if one doesn't exist
          if (!existingNotification) {
            const notif = await Notification.create({
              type: "comment",
              actor: _id,
              recipient: mentionedUserId,
              post: post._id,
              comment: updatedComment._id,
              title: `${username} mentioned you in a comment`,
              body: updatedComment.content
                ? String(updatedComment.content).slice(0, 140)
                : "",
            });

            io.to(String(mentionedUserId)).emit("notification", {
              ...notif.toObject(),
            });

            const unread = await Notification.countDocuments({
              recipient: mentionedUserId,
              isRead: false,
            });
            io.to(String(mentionedUserId)).emit("notifications_unread", {
              unread,
            });
          }
        }
      }
    }

    // Populate author and get replies for complete response
    const populatedComment = await Comment.findById(commentId)
      .populate("author", "username fullName avatar")
      .lean();

    // Get replies if this is a parent comment
    if (!populatedComment.parentComment) {
      populatedComment.replies = await Comment.find({
        parentComment: commentId,
      })
        .sort({ createdAt: 1 })
        .populate("author", "username avatar")
        .lean();
    }

    // Add isLiked for comment and replies
    const userId = req.user ? req.user._id : null;
    if (userId) {
      populatedComment.isLiked = populatedComment.likes.some(
        (like) => like.user && like.user.equals(userId),
      );

      if (populatedComment.replies) {
        for (const reply of populatedComment.replies) {
          reply.isLiked = reply.likes.some(
            (like) => like.user && like.user.equals(userId),
          );
        }
      }
    } else {
      populatedComment.isLiked = false;
      if (populatedComment.replies) {
        for (const reply of populatedComment.replies) {
          reply.isLiked = false;
        }
      }
    }

    // Emit comment update to all users
    const io = getIo?.();
    if (io) {
      io.emit("comment_updated", {
        success: true,
        message: "Comment updated successfully",
        data: populatedComment,
      });
    }

    res.status(200).json({
      success: true,
      message: "Comment updated successfully",
      data: populatedComment,
    });
  } catch (err) {
    console.error("Edit Comment Error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const likeDislikeComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user._id;
    const username = req.user.username;

    // Validate comment exists
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: "Comment not found",
      });
    }

    // Check if user already liked the comment
    const existingLikeIndex = comment.likes.findIndex(
      (like) => like.user && like.user.toString() === userId.toString(),
    );

    let action;

    if (existingLikeIndex === -1) {
      // Add like
      comment.likes.push({
        user: userId,
        username: username,
        timestamp: new Date(),
      });
      action = "liked";
    } else {
      // Remove like
      comment.likes.splice(existingLikeIndex, 1);
      action = "unliked";
    }

    // Update like count
    comment.likeCount = comment.likes.length;

    // Save the updated comment
    const updatedComment = await comment.save();

    // Notify comment author on like (skip if unliked or self-like)
    if (action === "liked") {
      const commentAuthorId = String(comment.author);
      const actorId = String(userId);
      if (commentAuthorId !== actorId) {
        const post = await Post.findById(comment.post);
        const notif = await Notification.create({
          type: "comment",
          actor: actorId,
          recipient: commentAuthorId,
          post: post?._id,
          comment: comment._id,
          title: `${username} liked your comment`,
          body: comment.content ? String(comment.content).slice(0, 140) : "",
        });
        const io = getIo?.();
        if (io) {
          io.to(commentAuthorId).emit("notification", {
            ...notif.toObject(),
          });
          const unread = await Notification.countDocuments({
            recipient: commentAuthorId,
            isRead: false,
          });
          io.to(commentAuthorId).emit("notifications_unread", { unread });
        }
      }
    }

    // Emit like update to all users
    const io = getIo?.();
    if (io) {
      io.emit("comment_like_updated", {
        success: true,
        message: `Comment ${action} successfully`,
        data: {
          ...comment.toObject(),
        },
      });
    }

    res.status(200).json({
      success: true,
      message: `Comment ${action} successfully`,
      data: {
        likeCount: updatedComment.likeCount,
        isLiked: action === "liked",
        commentId: commentId,
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

export const ReportComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { message } = req.body;

    const user = req.user; // reporting user

    // Fetch comment
    const comment = await Comment.findById(commentId)
      .populate("post")
      .populate("author");
    if (!comment) {
      return res
        .status(404)
        .json({ success: false, message: "Comment not found" });
    }

    const post = comment.post;

    // Redirect URL
    const redirectURL = `https://newuser.thesubset.org/connect/post/${post._id}?comment=${commentId}`;

    // ================================
    //         ADMIN EMAIL TEMPLATE
    // ================================
    const adminEmailContent = `
      <div style="max-width:700px;margin:auto;padding:20px;font-family:Arial;border:1px solid #eee;border-radius:10px;background:#fff;">
        
        <div style="text-align:center;margin-bottom:20px;">
          <img src="https://newuser.thesubset.org/assets/images/logo.svg" style="width:120px;" />
        </div>

        <h2 style="text-align:center;color:#333;">🚨 Comment Reported</h2>

        <p style="color:#555;font-size:15px;">A comment has been reported on The Subset.</p>

        <div style="padding:15px;background:#fafafa;border-radius:8px;margin-top:15px;">
          <p><strong>Comment Content:</strong></p>
          <p style="margin-left:10px;">${comment.content}</p>

          <p><strong>Comment Author:</strong> ${comment.authorName}</p>
          <p><strong>Post Title:</strong> ${post.title}</p>
          
          <p><strong>Reported By:</strong> ${user.fullName} (${user.email})</p>

          ${
            message
              ? `<p><strong>Report Message:</strong></p><p style="margin-left:10px;">${message}</p>`
              : ""
          }
        </div>

        <div style="text-align:center;margin-top:25px;">
          <a href="${redirectURL}"
            style="display:inline-block;padding:12px 22px;background:#0077ff;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">
            View Reported Comment
          </a>
        </div>

        <p style="color:#888;font-size:13px;text-align:center;margin-top:30px;border-top:1px solid #eee;padding-top:10px;">
          © ${new Date().getFullYear()} The Subset. All rights reserved.
        </p>
      </div>
    `;

    // ================================
    //        USER EMAIL TEMPLATE
    // ================================
    const userEmailContent = `
      <div style="max-width:700px;margin:auto;padding:25px;font-family:Arial;border:1px solid #eee;border-radius:10px;background:#fafafa;">
        
        <div style="text-align:center;">
          <img src="https://newuser.thesubset.org/assets/images/logo.svg" style="width:120px;margin-bottom:20px;" />
        </div>

        <h2 style="text-align:center;color:#333;">👍 Your Comment Report Is Received</h2>

        <p style="color:#555;font-size:15px;text-align:center;">
          Thanks for helping keep our community safe. Our moderation team will review this comment.
        </p>

        <div style="padding:15px;background:#fff;border:1px solid #eee;border-radius:8px;margin-top:20px;">
          <p><strong>Reported Comment:</strong></p>
          <p style="margin-left:10px;">${comment.content}</p>

          ${
            message
              ? `<p><strong>Your Message:</strong></p><p style="margin-left:10px;">${message}</p>`
              : ""
          }
        </div>

        <p style="color:#888;font-size:13px;text-align:center;margin-top:30px;border-top:1px solid #eee;padding-top:10px;">
          We'll notify you once the review is completed.
        </p>

        <p style="color:#aaa;font-size:12px;text-align:center;margin-top:20px;">
          © ${new Date().getFullYear()} The Subset. All Rights Reserved.
        </p>
      </div>
    `;

    // ================================
    //           SEND EMAILS
    // ================================
    await sendEmail(
      "contact@thesubset.org",
      "🚨 Comment Reported",
      adminEmailContent,
    );

    await sendEmail(
      user.email,
      "✔️ We've received your comment report",
      userEmailContent,
    );

    return res.json({
      success: true,
      message: "Comment reported successfully.",
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
