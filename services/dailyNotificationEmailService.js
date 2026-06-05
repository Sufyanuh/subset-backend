// services/dailyNotificationEmailService.js
import { Notification } from "../model/notification.js";
import { User } from "../model/user.js";
import { logger } from "../utils/logger.js";
import { generateEmailTemplate } from "../utils/notificaionWebTemplate.js";
import { sendEmail, isTransientSmtpError } from "../utils/sendEmail.js";

const THROTTLE_DELAY_MS = 1000;      // pause between each user during the main pass
const RETRY_INITIAL_DELAY_MS = 5000; // wait before starting the retry pass
const RETRY_THROTTLE_MS = 2000;      // pause between each retry attempt

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send daily notification summary emails to all users with unread
 * notifications from the last 4 days (temporary backfill run).
 *
 * Flow:
 *  1. Main pass  — try every user; if a 421/transient error occurs, push to retryQueue.
 *  2. Retry pass — after the main pass finishes, drain the retryQueue one by one
 *                  until every queued email is successfully sent.
 */
export const sendDailyNotificationEmails = async () => {
  try {
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000); // last 24 hours

    logger.info(`📧 Starting daily notification email job...`);
    logger.info(`⏰ Time window: ${since.toISOString()} → ${now.toISOString()}`);

    const recipientIds = await Notification.distinct("recipient", {
      createdAt: { $gte: since, $lte: now },
      isRead: false,
      emailSent: false,
    });

    logger.info(`👥 Found ${recipientIds.length} user(s) with pending notifications`);

    let emailsSent = 0;
    let errors = 0;

    // Each entry: { userId, since, now } — queued for retry after the main pass
    const retryQueue = [];

    // ── MAIN PASS ──────────────────────────────────────────────────────────────
    for (const userId of recipientIds) {
      try {
        const result = await sendEmailToUser(userId, since, now);
        if (result.success) {
          emailsSent++;
        } else if (result.transient) {
          // Transient failure (421 etc.) — defer to retry pass
          logger.warn(`⏳ Queued user ${userId} for retry: ${result.reason}`);
          retryQueue.push({ userId, since, now });
        } else {
          // Skipped (no email, disabled, no notifications) — not an error
          logger.info(`⏭️  Skipped user ${userId}: ${result.reason}`);
        }
      } catch (error) {
        errors++;
        logger.error(`❌ Unexpected error processing user ${userId}:`, error);
      }

      await sleep(THROTTLE_DELAY_MS);
    }

    logger.info(
      `📬 Main pass done. Sent: ${emailsSent}, Queued for retry: ${retryQueue.length}, Errors: ${errors}`
    );

    // ── RETRY PASS ─────────────────────────────────────────────────────────────
    if (retryQueue.length > 0) {
      logger.info(`🔁 Starting retry pass for ${retryQueue.length} queued email(s)...`);
      await sleep(RETRY_INITIAL_DELAY_MS); // give AWS SMTP a breather before retrying

      let retryIndex = 0;

      // Keep going until every queued item is sent (or permanently fails)
      while (retryQueue.length > 0) {
        const item = retryQueue[retryIndex % retryQueue.length];

        try {
          const result = await sendEmailToUser(item.userId, item.since, item.now);

          if (result.success) {
            emailsSent++;
            logger.info(`✅ Retry succeeded for user ${item.userId}`);
            retryQueue.splice(retryIndex % retryQueue.length, 1);
          } else if (result.transient) {
            // Still failing transiently — leave it in the queue and come back
            logger.warn(`⏳ Retry still transient for user ${item.userId}: ${result.reason}`);
            retryIndex++;
          } else {
            // Permanently skippable (no email, disabled, etc.) — remove from queue
            logger.info(`⏭️  Retry skipped user ${item.userId}: ${result.reason}`);
            retryQueue.splice(retryIndex % retryQueue.length, 1);
          }
        } catch (error) {
          // Unexpected / permanent error — remove from queue so we don't loop forever
          errors++;
          logger.error(`❌ Retry permanent error for user ${item.userId}:`, error);
          retryQueue.splice(retryIndex % retryQueue.length, 1);
        }

        if (retryQueue.length > 0) {
          await sleep(RETRY_THROTTLE_MS);
        }
      }

      logger.info(`🔁 Retry pass complete.`);
    }

    logger.info(
      `✅ Email job done. Sent: ${emailsSent}, Errors: ${errors}, Total: ${recipientIds.length}`
    );

    return {
      success: true,
      totalUsers: recipientIds.length,
      emailsSent,
      errors,
    };
  } catch (error) {
    logger.error("❌ Fatal error in sendDailyNotificationEmails:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Send a notification summary email to a single user.
 *
 * Returns:
 *   { success: true,  count }               — email sent, notifications marked
 *   { success: false, reason, transient }   — skipped or failed
 *     transient: true  → caller should queue for retry
 *     transient: false → permanent skip, do not retry
 */
const sendEmailToUser = async (userId, startDate, endDate) => {
  const user = await User.findById(userId).select(
    "email username fullName notificationSettings _id"
  );

  if (!user?.email) return { success: false, reason: "No email on record", transient: false };
  if (user.notificationSettings?.emailNotifications === false)
    return { success: false, reason: "Email notifications disabled by user", transient: false };

  const notifications = await Notification.find({
    recipient: userId,
    createdAt: { $gte: startDate, $lte: endDate },
    isRead: false,
    emailSent: false,
  })
    .populate("actor", "username fullName avatar")
    .populate("post", "title")
    .populate("comment", "content")
    .populate("message", "content")
    .sort({ createdAt: -1 });

  if (notifications.length === 0)
    return { success: false, reason: "No unread notifications", transient: false };

  const grouped = groupNotificationsByType(notifications);
  const emailContent = generateEmailTemplate(user, grouped);

  try {
    await sendEmail(
      user.email,
      `Here's your daily SUB•SET Connect activity`,
      emailContent
    );
  } catch (err) {
    if (isTransientSmtpError(err)) {
      logger.warn(`⚠️  Transient SMTP error for ${user.email}: ${err.message}`);
      return { success: false, reason: err.message, transient: true };
    }
    // Permanent error — rethrow so the caller logs it as a real error
    throw err;
  }

  logger.info(`✅ Sent email to ${user.email} (${notifications.length} notification(s))`);

  await Notification.updateMany(
    { _id: { $in: notifications.map((n) => n._id) } },
    { $set: { emailSent: true, emailSentAt: new Date() } }
  );

  return { success: true, count: notifications.length };
};

/**
 * Categorise notifications into groups for the email template.
 */
const groupNotificationsByType = (notifications) => {
  const groups = {
    mentions: [],
    messages: [],
    replies: [],
    likes: [],
    comments: [],
    others: [],
  };

  for (const notification of notifications) {
    const title = notification.title || "";

    if (title.includes("mentioned you")) {
      groups.mentions.push(notification);
    } else if (notification.type === "message") {
      groups.messages.push(notification);
    } else if (title.includes("replied") || title.includes("commented on")) {
      groups.replies.push(notification);
    } else if (title.includes("liked")) {
      groups.likes.push(notification);
    } else if (notification.type === "comment") {
      groups.comments.push(notification);
    } else {
      groups.others.push(notification);
    }
  }

  return groups;
};
