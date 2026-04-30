import { Boards } from "../../model/boards.js";
import { User } from "../../model/user.js";
import mongoose from "mongoose";
import Post from "../../model/post.js";
import Comment from "../../model/comment.js";
import { Message } from "../../model/chatMessage.js";
import { Conversation } from "../../model/conversation.js";
import { Notification } from "../../model/notification.js";
import { deleteMediaFiles } from "../../utils/deleteMediaFiles.js";
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});
export const getUserByUserName = async (req, res) => {
  const { username } = req.params;

  if (!username) {
    return res.status(401).json({ message: "Missing auth token." });
  }

  try {
    const user = await User.findOne({ username }).populate("discover");
    const boards = await Boards.find({ userId: user._id }).populate("discover");
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    const updatedUser = { ...user.toObject() };
    delete updatedUser.token;
    delete updatedUser.password;
    res
      .status(200)
      .json({ message: "User Found", data: { ...updatedUser, boards } });
  } catch (errors) {
    console.error("Error fetching user:", errors);
    res.status(500).json({ message: errors.message, errors });
  }
};

export const SaveDiscoverToUser = async (req, res) => {
  const { discoverId } = req.body;
  const { _id: userId } = req.user;

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!user.isPaid && user.discover.length >= 13) {
      return res
        .status(403)
        .json({ message: "Upgrade to a paid plan to save more discoveries." });
    }
    // Check if the discover ID already exists in the user's savedDiscoveries array
    if (user.discover.includes(discoverId)) {
      return res.status(400).json({ message: "Discover already saved" });
    }

    // Add the discover ID to the user's savedDiscoveries array
    user.discover.push(discoverId);
    await user.save();

    res
      .status(200)
      .json({ message: "Discover saved successfully", data: user });
  } catch (errors) {
    console.error("Error saving discover:", errors);
    res.status(500).json({ message: errors.message, errors });
  }
};
export const RemoveDiscoverFromUser = async (req, res) => {
  const { discoverId } = req.params;
  const { _id: userId } = req.user;

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if the discover ID exists in the user's array
    const index = user.discover.indexOf(discoverId);
    if (index === -1) {
      return res
        .status(400)
        .json({ message: "Discover not found in saved list" });
    }

    // Remove it
    user.discover.splice(index, 1);
    await user.save();

    res.status(200).json({
      message: "Discover removed successfully",
      data: user,
    });
  } catch (errors) {
    console.error("Error removing discover:", errors);
    res.status(500).json({ message: errors.message, errors });
  }
};

export const editProfile = async (req, res) => {
  try {
    const userId = req.user?._id; // assuming JWT middleware attaches user info

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized access" });
    }

    // Allowed fields to be updated
    const allowedFields = [
      "fullName",
      "username",
      "email",
      "password",
      "title",
      "country",
      "city",
      "website",
      "instagram",
      "facebook",
      "linkedin",
      "twitter",
      "bluesky",
      "pinterest",
      "behance",
      "youtube",
      "avatar",
    ];

    // Filter only allowed fields and normalize
    const updates = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        let value = req.body[key];
        if (typeof value === "string") {
          value = value.trim();
        }
        updates[key] = value;
      }
    }

    // Normalize email
    if (updates.email) {
      updates.email = String(updates.email).toLowerCase();
    }

    // Prevent empty updates
    if (Object.keys(updates).length === 0) {
      return res
        .status(400)
        .json({ message: "No valid fields provided to update." });
    }

    // Ensure unique email (if changed)
    if (updates.email) {
      const existingEmail = await User.findOne({
        email: updates.email,
        _id: { $ne: userId },
      });
      if (existingEmail) {
        return res
          .status(400)
          .json({ message: "Email already in use by another account." });
      }
    }

    // Ensure unique username (if changed)
    if (updates.username) {
      const existingUsername = await User.findOne({
        username: updates.username,
        _id: { $ne: userId },
      });
      if (existingUsername) {
        return res.status(400).json({ message: "Username already taken." });
      }
    }

    // Treat empty password as no-op
    if (
      typeof updates.password === "string" &&
      updates.password.trim() === ""
    ) {
      delete updates.password;
    }

    // Validate password strength if provided
    if (updates.password && String(updates.password).length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters." });
    }

    // If password present, securely update it (to trigger pre-save hashing)
    let updatedUser;
    if (updates.password) {
      // Remove password from updates for now
      const password = updates.password;
      delete updates.password;

      // Pehle baaki fields update karo
      updatedUser = await User.findByIdAndUpdate(
        userId,
        { $set: updates },
        { new: true, runValidators: true, select: "-password" }
      );

      // Now update password separately using document instance so pre('save') hooks run
      const userDoc = await User.findById(userId);
      userDoc.password = password;
      await userDoc.save(); // This will hash password if schema mein pre-save hook hai

      // Remove password field before sending
      const userObj = userDoc.toObject();
      delete userObj.password;

      // Propagate denormalized profile fields if changed
      const usernameChanged = Boolean(updates.username);
      const avatarChanged = Boolean(updates.avatar);
      if (usernameChanged || avatarChanged) {
        const setPost = {};
        const setComment = {};
        if (usernameChanged) {
          setPost.authorName = updates.username;
          setComment.authorName = updates.username;
        }
        if (avatarChanged) {
          setPost.authorAvatar = updates.avatar || null;
          setComment.authorAvatar = updates.avatar || null;
        }
        if (Object.keys(setPost).length > 0) {
          await Promise.all([
            Post.updateMany({ author: userId }, { $set: setPost }),
            Comment.updateMany({ author: userId }, { $set: setComment }),
          ]);
        }
      }

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        user: userObj,
      });
    } else {
      // No password, simple update
      updatedUser = await User.findByIdAndUpdate(
        userId,
        { $set: updates },
        { new: true, runValidators: true, select: "-password" }
      );

      // Propagate denormalized profile fields if changed
      const usernameChanged = Boolean(updates.username);
      const avatarChanged = Boolean(updates.avatar);
      if (usernameChanged || avatarChanged) {
        const setPost = {};
        const setComment = {};
        if (usernameChanged) {
          setPost.authorName = updates.username;
          setComment.authorName = updates.username;
        }
        if (avatarChanged) {
          setPost.authorAvatar = updates.avatar || null;
          setComment.authorAvatar = updates.avatar || null;
        }
        if (Object.keys(setPost).length > 0) {
          await Promise.all([
            Post.updateMany({ author: userId }, { $set: setPost }),
            Comment.updateMany({ author: userId }, { $set: setComment }),
          ]);
        }
      }

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        user: updatedUser,
      });
    }
  } catch (error) {
    console.error("Error updating profile:", error);
    return res.status(500).json({
      error,
      message: error.message,
    });
  }
};

export const deleteUser = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await session.withTransaction(async () => {
      // 1) Collect user's posts to clean related data (comments + media)
      const userPosts = await Post.find({ author: userId }).session(session);

      // Delete comments for each post and remove media files
      for (const post of userPosts) {
        // Delete comments under this post
        await Comment.deleteMany({ post: post._id }).session(session);
        // Delete post media files from disk
        if (Array.isArray(post.media) && post.media.length > 0) {
          deleteMediaFiles(post.media);
        }
      }

      // Delete the posts themselves
      await Post.deleteMany({ author: userId }).session(session);

      // 2) Delete comments authored by the user on other posts (and their media)
      const authoredComments = await Comment.find({ author: userId }).session(
        session
      );
      for (const c of authoredComments) {
        if (Array.isArray(c.media) && c.media.length > 0) {
          deleteMediaFiles(c.media);
        }
      }
      await Comment.deleteMany({ author: userId }).session(session);

      // 3) Remove likes and mentions added by this user across posts/comments
      await Post.updateMany(
        { "likes.user": userId },
        { $pull: { likes: { user: userId } } }
      ).session(session);
      await Comment.updateMany(
        { "likes.user": userId },
        { $pull: { likes: { user: userId } } }
      ).session(session);
      await Post.updateMany(
        { mentions: userId },
        { $pull: { mentions: userId } }
      ).session(session);
      await Comment.updateMany(
        { mentions: userId },
        { $pull: { mentions: userId } }
      ).session(session);

      // 4) Delete boards owned by the user
      await Boards.deleteMany({ userId }).session(session);

      // 5) Delete messages and conversations involving the user
      await Message.deleteMany({
        $or: [{ sender: userId }, { recipient: userId }],
      }).session(session);
      await Conversation.deleteMany({
        $or: [{ userA: userId }, { userB: userId }],
      }).session(session);

      // 6) Delete notifications where user is actor or recipient
      await Notification.deleteMany({
        $or: [{ actor: userId }, { recipient: userId }],
      }).session(session);

      // 8) Finally, delete the user
      await User.findByIdAndDelete(userId).session(session);
    });
    if (user.stripeSubscriptionId)
      await stripe.subscriptions.cancel(user.stripeSubscriptionId);

    return res.status(200).json({
      message: "User and related data deleted successfully",
      deletedUserId: String(userId),
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  } finally {
    session.endSession();
  }
};

export const toggleEmailNotifications = async (req, res) => {
  try {
    const { _id: userId } = req.user;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.notificationSettings.emailNotifications =
      !user.notificationSettings.emailNotifications;

    await user.save();

    // Redirect after success
    return res.status(200).json({
      data: user,
      message: "Email notification setting updated successfully.",
    });
  } catch (error) {
    console.error("Error toggling email notifications:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

export const getSubscriptionDetails = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let subscriptionDetails = null;

    // Agar Stripe subscription hai toh details fetch karein
    if (user.stripeSubscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          user.stripeSubscriptionId
        );
        subscriptionDetails = {
          id: subscription.id,
          status: subscription.status,
          currentPeriodStart: subscription.current_period_start,
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          items: subscription.items.data.map((item) => ({
            price: {
              id: item.price.id,
              product: item.price.product,
              amount: item.price.unit_amount,
              currency: item.price.currency,
              interval: item.price.recurring?.interval,
            },
          })),
        };
      } catch (stripeError) {
        console.error("Stripe subscription fetch error:", stripeError);
      }
    }

    res.json({
      user: {
        isPaid: user.isPaid,
        isTrial: user.isTrial,
        isAdmin: user.isAdmin,
        subscriptionStatus: user.subscriptionStatus,
        billingCycle: user.billingCycle,
        planName: user.planName,
        trialEnd: user.trialEnd,
        currentPeriodEnd: user.currentPeriodEnd,
        stripeSubscriptionId: user.stripeSubscriptionId,
        createdAt: user.createdAt,
      },
      subscription: subscriptionDetails,
    });
  } catch (error) {
    console.error("Subscription details error:", error);
    res.status(500).json({ message: error.message });
  }
};
