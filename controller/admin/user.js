import dotenv from "dotenv";
import mongoose from "mongoose";
import Stripe from "stripe";
import { Boards } from "../../model/boards.js";
import { Message } from "../../model/chatMessage.js";
import Comment from "../../model/comment.js";
import { Conversation } from "../../model/conversation.js";
import { Notification } from "../../model/notification.js";
import Post from "../../model/post.js";
import { User } from "../../model/user.js";
import { getUserSubscription } from "../../services/getUserSubscription.js";

dotenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({})
      .select("-password -token") // Exclude sensitive fields
      .sort({ isAdmin: -1 });

    res.status(200).json({
      message: "Users fetched successfully",
      data: users,
      count: users.length,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Failed to fetch users." });
  }
};

export const deleteUser = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { userId } = req.params;

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

      // 7) Finally, delete the user
      await User.findByIdAndDelete(userId).session(session);
    });

    // ✅ Cancel Stripe subscription if exists
    if (user.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(user.stripeSubscriptionId);
        console.log(`✅ Stripe subscription canceled for user ${userId}`);
      } catch (stripeError) {
        console.error("Error canceling Stripe subscription:", stripeError);
        // Continue with user deletion even if Stripe cancel fails
      }
    }

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

export const toggleActiveStatus = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const newStatus = !user.isActive;

    await User.findByIdAndUpdate(
      userId,
      { isActive: newStatus },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      message: `${user.username} isActive set to ${newStatus} successfully.`,
      isActive: newStatus,
    });
  } catch (error) {
    console.error("Toggle active status error:", error);
    res.status(500).json({
      message: error.message,
      error: error,
    });
  }
};

export const togglePaidStatus = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const newStatus = !user.isPaid;

    // ✅ Enhanced paid status toggle with proper subscription handling
    const updateData = {
      isPaid: newStatus,
    };

    // If enabling paid status, set proper subscription status
    if (newStatus) {
      updateData.subscriptionStatus = "active";
      updateData.isTrial = false;
      updateData.billingCycle = "lifetime"; // Admin granted lifetime access
      updateData.planName = "Admin Premium Plan";
      updateData.currentPeriodEnd = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000
      ); // 1 year
      updateData.currentPeriodStart = new Date();
    } else {
      // If disabling paid status, check if user has Stripe subscription
      if (!user.stripeSubscriptionId) {
        updateData.subscriptionStatus = "inactive";
        updateData.isTrial = false;
        updateData.billingCycle = null;
        updateData.planName = null;
        updateData.currentPeriodEnd = null;
        updateData.currentPeriodStart = null;
      } else {
        // User has Stripe subscription - only remove admin-granted benefits
        updateData.billingCycle = user.billingCycle; // Keep Stripe billing cycle
        updateData.planName = user.planName; // Keep Stripe plan name
        // Don't modify subscriptionStatus as it's managed by Stripe
      }
    }

    await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      message: `${user.username} isPaid set to ${newStatus} successfully.`,
      isPaid: newStatus,
      subscriptionStatus: updateData.subscriptionStatus,
      billingCycle: updateData.billingCycle,
    });
  } catch (error) {
    console.error("Toggle paid status error:", error);
    res.status(500).json({
      message: error.message,
      error: error,
    });
  }
};

export const toggleAdminStatus = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const newStatus = !user.isAdmin;

    // ✅ Enhanced admin toggle with complete subscription management
    const updateData = {
      isAdmin: newStatus,
    };

    // ✅ Grant premium access when making admin
    if (newStatus === true) {
      updateData.isPaid = true;
      updateData.isTrial = false;
      updateData.subscriptionStatus = "active";
      updateData.billingCycle = "lifetime";
      updateData.planName = "Admin Lifetime Plan";
      updateData.planId = "admin_lifetime";
      updateData.currentPeriodStart = new Date();
      updateData.currentPeriodEnd = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000
      ); // 1 year
      updateData.trialStart = null;
      updateData.trialEnd = null;
      updateData.willCancelAt = null;
      updateData.cancelAtPeriodEnd = false;
      updateData.canceledAt = null;

      console.log(
        `⭐ Admin privileges granted to ${user.username} with premium access`
      );
    } else {
      // ✅ When removing admin, preserve Stripe subscription if exists
      if (!user.stripeSubscriptionId) {
        // No Stripe subscription - remove premium access
        updateData.isPaid = false;
        updateData.subscriptionStatus = "inactive";
        updateData.billingCycle = null;
        updateData.planName = null;
        updateData.planId = null;
        updateData.currentPeriodStart = null;
        updateData.currentPeriodEnd = null;
        console.log(
          `🔻 Admin removed from ${user.username}, premium access revoked`
        );
      } else {
        // User has Stripe subscription - keep their paid status
        updateData.isPaid = true; // Keep paid status from Stripe
        console.log(
          `🔻 Admin removed from ${user.username}, Stripe subscription preserved`
        );
      }
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    });

    const action = newStatus ? "promoted to Admin" : "demoted from Admin";
    res.status(200).json({
      message: `${user.username} ${action} successfully. ${
        newStatus ? "Premium access granted automatically." : ""
      }`,
      isAdmin: newStatus,
      isPaid: updatedUser.isPaid,
      subscriptionStatus: updatedUser.subscriptionStatus,
      user: {
        username: user.username,
        email: user.email,
        isAdmin: newStatus,
        isPaid: updatedUser.isPaid,
        subscriptionStatus: updatedUser.subscriptionStatus,
        billingCycle: updatedUser.billingCycle,
        planName: updatedUser.planName,
      },
    });
  } catch (error) {
    console.error("Toggle admin status error:", error);
    res.status(500).json({
      message: error.message,
      error: error,
    });
  }
};

export const updateUser = async (req, res) => {
  const { userId } = req.params;
  const updateData = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // ✅ Validate and normalize billingCycle
    if (updateData.billingCycle) {
      if (
        !["monthly", "yearly", "lifetime", null].includes(
          updateData.billingCycle
        )
      ) {
        delete updateData.billingCycle;
      }
    }

    // ✅ Enhanced admin promotion with complete subscription setup
    if (updateData.isAdmin === true && !user.isAdmin) {
      updateData.isPaid = true;
      updateData.isTrial = false;
      updateData.subscriptionStatus = "active";
      updateData.billingCycle = "lifetime";
      updateData.planName = "Admin Lifetime Plan";
      updateData.planId = "admin_lifetime";
      updateData.currentPeriodStart = new Date();
      updateData.currentPeriodEnd = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000
      ); // 1 year
      updateData.trialStart = null;
      updateData.trialEnd = null;
      updateData.willCancelAt = null;
      updateData.cancelAtPeriodEnd = false;
      updateData.canceledAt = null;

      console.log(
        `⭐ Auto-premium access granted to new admin: ${user.username}`
      );
    }

    // ✅ Enhanced admin removal with subscription preservation
    if (updateData.isAdmin === false && user.isAdmin) {
      // Preserve Stripe subscription if exists
      if (!user.stripeSubscriptionId) {
        updateData.isPaid = false;
        updateData.subscriptionStatus = "inactive";
        updateData.billingCycle = null;
        updateData.planName = null;
        updateData.planId = null;
        updateData.currentPeriodStart = null;
        updateData.currentPeriodEnd = null;
        console.log(
          `🔻 Admin removed from ${user.username}, premium access revoked`
        );
      } else {
        // Keep Stripe-managed subscription details
        console.log(
          `🔻 Admin removed from ${user.username}, Stripe subscription preserved`
        );
      }
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      message: "User updated successfully.",
      user: {
        _id: updatedUser._id,
        fullName: updatedUser.fullName,
        username: updatedUser.username,
        email: updatedUser.email,
        isPaid: updatedUser.isPaid,
        isAdmin: updatedUser.isAdmin,
        isActive: updatedUser.isActive,
        isTrial: updatedUser.isTrial,
        subscriptionStatus: updatedUser.subscriptionStatus,
        billingCycle: updatedUser.billingCycle,
        trialStart: updatedUser.trialStart,
        trialEnd: updatedUser.trialEnd,
        currentPeriodStart: updatedUser.currentPeriodStart,
        currentPeriodEnd: updatedUser.currentPeriodEnd,
        planName: updatedUser.planName,
        planId: updatedUser.planId,
        stripeCustomerId: updatedUser.stripeCustomerId,
        stripeSubscriptionId: updatedUser.stripeSubscriptionId,
        cancelAtPeriodEnd: updatedUser.cancelAtPeriodEnd,
        willCancelAt: updatedUser.willCancelAt,
      },
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      message: error.message,
      error: error,
    });
  }
};

// ✅ ENHANCED: Refresh subscription from Stripe with complete status sync
export const refreshUserSubscription = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (!user.stripeSubscriptionId) {
      return res.status(400).json({
        message: "User has no active Stripe subscription.",
        hasStripeSubscription: false,
      });
    }

    // ✅ Use the schema method for complete Stripe sync
    const syncResult = await user.syncSubscriptionWithStripe(stripe);

    // Get updated user data
    const updatedUser = await User.findById(userId);

    res.status(200).json({
      message: "Subscription synced successfully with Stripe.",
      syncResult: syncResult,
      subscription: {
        subscriptionStatus: updatedUser.subscriptionStatus,
        isPaid: updatedUser.isPaid,
        isTrial: updatedUser.isTrial,
        billingCycle: updatedUser.billingCycle,
        planName: updatedUser.planName,
        planId: updatedUser.planId,
        currentPeriodStart: updatedUser.currentPeriodStart,
        currentPeriodEnd: updatedUser.currentPeriodEnd,
        trialStart: updatedUser.trialStart,
        trialEnd: updatedUser.trialEnd,
        cancelAtPeriodEnd: updatedUser.cancelAtPeriodEnd,
        willCancelAt: updatedUser.willCancelAt,
        canceledAt: updatedUser.canceledAt,
        stripeCustomerId: updatedUser.stripeCustomerId,
        stripeSubscriptionId: updatedUser.stripeSubscriptionId,
        stripePriceId: updatedUser.stripePriceId,
        stripeProductId: updatedUser.stripeProductId,
        latestInvoiceStatus: updatedUser.latestInvoiceStatus,
      },
      access: updatedUser.checkSubscriptionAccess(),
    });
  } catch (error) {
    console.error("Refresh subscription error:", error);

    // ✅ Enhanced error handling for Stripe sync
    if (error.code === "resource_missing") {
      // Subscription not found in Stripe - mark as inactive
      await User.findByIdAndUpdate(
        userId,
        {
          isPaid: false,
          isTrial: false,
          subscriptionStatus: "inactive",
          stripeSubscriptionId: null,
          stripePriceId: null,
          billingCycle: null,
          planName: null,
          planId: null,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          trialStart: null,
          trialEnd: null,
          cancelAtPeriodEnd: false,
          willCancelAt: null,
          canceledAt: new Date(),
          latestInvoiceId: null,
          latestInvoiceStatus: null,
        },
        { new: true, runValidators: true }
      );

      return res.status(200).json({
        message: "Subscription not found in Stripe. User marked as inactive.",
        subscription: {
          isPaid: false,
          isTrial: false,
          subscriptionStatus: "inactive",
          hasStripeSubscription: false,
        },
      });
    }

    res.status(500).json({
      message: "Failed to sync subscription with Stripe",
      error: error.message,
    });
  }
};

export const checkUsersSubscription = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const subscription = await getUserSubscription(userId);

    if (!subscription) {
      return res.status(404).json({ message: "No subscription found" });
    }

    return res.status(200).json({
      subscription,
      hasActiveSubscription: subscription.hasAccess,
    });
  } catch (error) {
    console.error("Check subscription error:", error);
    return res.status(500).json({
      message: error.message,
      error: error,
    });
  }
};

export const getUserSubscriptionDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get subscription summary using schema method
    const subscriptionSummary = user.getSubscriptionSummary();

    // Get Stripe subscription details if available
    let stripeSubscription = null;
    if (user.stripeSubscriptionId) {
      try {
        stripeSubscription = await stripe.subscriptions.retrieve(
          user.stripeSubscriptionId,
          {
            expand: ["latest_invoice", "default_payment_method"],
          }
        );
      } catch (stripeError) {
        console.error("Error fetching Stripe subscription:", stripeError);
        // Continue without Stripe data
      }
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin,
      },
      subscription: subscriptionSummary,
      stripeSubscription: stripeSubscription
        ? {
            id: stripeSubscription.id,
            status: stripeSubscription.status,
            currentPeriodStart: new Date(
              stripeSubscription.current_period_start * 1000
            ),
            currentPeriodEnd: new Date(
              stripeSubscription.current_period_end * 1000
            ),
            cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
            canceledAt: stripeSubscription.canceled_at
              ? new Date(stripeSubscription.canceled_at * 1000)
              : null,
            latestInvoice: stripeSubscription.latest_invoice
              ? {
                  id: stripeSubscription.latest_invoice.id,
                  status: stripeSubscription.latest_invoice.status,
                  amountPaid: stripeSubscription.latest_invoice.amount_paid,
                  pdfUrl: stripeSubscription.latest_invoice.invoice_pdf,
                }
              : null,
          }
        : null,
    });
  } catch (error) {
    console.error("Get user subscription details error:", error);
    return res.status(500).json({
      message: "Failed to get subscription details",
      error: error.message,
    });
  }
};

export const syncAllUsersWithStripe = async (req, res) => {
  try {
    const usersWithSubscriptions = await User.find({
      stripeSubscriptionId: { $exists: true, $ne: null },
    });

    const results = {
      total: usersWithSubscriptions.length,
      successful: 0,
      failed: 0,
      details: [],
    };

    for (const user of usersWithSubscriptions) {
      try {
        await user.syncSubscriptionWithStripe(stripe);
        results.successful++;
        results.details.push({
          userId: user._id,
          username: user.username,
          status: "success",
          subscriptionStatus: user.subscriptionStatus,
        });
      } catch (error) {
        results.failed++;
        results.details.push({
          userId: user._id,
          username: user.username,
          status: "failed",
          error: error.message,
        });
      }
    }

    return res.status(200).json({
      message: `Stripe sync completed: ${results.successful} successful, ${results.failed} failed`,
      results,
    });
  } catch (error) {
    console.error("Sync all users error:", error);
    return res.status(500).json({
      message: "Failed to sync users with Stripe",
      error: error.message,
    });
  }
};
export const toggleEmailNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.notificationSettings.emailNotifications =
      !user.notificationSettings.emailNotifications;

    await user.save();

    // Redirect after success
    return res.status(200).json({
      message: `Email notifications have been ${
        user.notificationSettings.emailNotifications ? "enabled" : "disabled"
      }.`,
      emailNotifications: user.notificationSettings.emailNotifications,
    });
  } catch (error) {
    console.error("Error toggling email notifications:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
