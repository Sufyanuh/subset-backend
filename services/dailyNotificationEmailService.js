// services/dailyNotificationEmailService.js
import { Notification } from "../model/notification.js";
import { User } from "../model/user.js";
import { logger } from "../utils/logger.js";
import { generateEmailTemplate } from "../utils/notificaionWebTemplate.js";
import { sendEmail } from "../utils/sendEmail.js";

/**
 * Send daily notification summary emails to all users in a queue
 */
export const sendDailyNotificationEmails = async () => {
  try {
    console.log("📧 Starting daily notification email job...");
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const today = new Date();

    // Start of yesterday
    const startOfYesterday = new Date(today);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);

    // End of today
    const endOfToday = new Date(today);
    endOfToday.setHours(23, 59, 59, 999);

    // Get all users who have unread notifications
    const notifiedUserIds = await Notification.distinct("recipient", {
      createdAt: { $gte: startOfYesterday, $lte: endOfToday },
      isRead: false,
      emailSent: false,
    });

    console.log(`Found ${notifiedUserIds.length} users with notifications`);

    let emailsSent = 0;
    let errors = 0;

    // Process emails sequentially (queue)
    for (const userId of notifiedUserIds) {
      const user = await User.findById(userId);
      if (!user) continue;

      try {
        const result = await sendEmailToUser(
          userId,
          startOfYesterday,
          endOfToday
        );
        if (result.success) emailsSent++;
        else errors++;
        await sleep(500); // 0.5 second delay between emails
      } catch (error) {
        errors++;
        console.error(`❌ Error for user ${user.email}:`, error.message);
      }

      // Optional: small delay between emails to avoid throttling
      await new Promise((res) => setTimeout(res, 500)); // 500ms delay
    }

    console.log(
      `✅ Daily email job completed. Sent: ${emailsSent}, Errors: ${errors}`
    );

    return {
      success: true,
      totalUsers: notifiedUserIds.length,
      emailsSent,
      errors,
    };
  } catch (error) {
    console.error("❌ Error in sendDailyNotificationEmails:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Send email to a specific user
 */
const sendEmailToUser = async (userId, startDate, endDate) => {
  const user = await User.findById(userId).select(
    "email username fullName notificationSettings _id"
  );

  if (!user || !user.email) return { success: false, reason: "No email" };
  if (user.notificationSettings?.emailNotifications === false)
    return { success: false, reason: "Notifications disabled" };

  // Get user's unread notifications that were not emailed yet
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
    return { success: false, reason: "No notifications" };

  const groupedNotifications = groupNotificationsByType(notifications);

  const emailContent = generateEmailTemplate(user, groupedNotifications);

  await sendEmail(
    user.email,
    `Here’s your daily SUB•SET Connect activity`,
    emailContent
  );

  console.log(
    `✅ Sent email to ${user.email} (${notifications.length} notifications)`
  );
  logger.info(
    `✅ Sent email to ${user.email} (${notifications.length} notifications)`
  );

  // Mark notifications as emailed
  await markNotificationsAsEmailed(notifications);

  return { success: true, count: notifications.length };
};

/**
 * Group notifications by type
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

  notifications.forEach((notification) => {
    const title = notification.title || "";

    if (title.includes("mentioned you")) groups.mentions.push(notification);
    else if (notification.type === "message")
      groups.messages.push(notification);
    else if (title.includes("replied") || title.includes("commented on"))
      groups.replies.push(notification);
    else if (title.includes("liked")) groups.likes.push(notification);
    else if (notification.type === "comment")
      groups.comments.push(notification);
    else groups.others.push(notification);
  });

  return groups;
};

/**
 * Mark notifications as emailed
 */
const markNotificationsAsEmailed = async (notifications) => {
  try {
    const notificationIds = notifications.map((n) => n._id);
    await Notification.updateMany(
      { _id: { $in: notificationIds } },
      { $set: { emailSent: true, emailSentAt: new Date() } }
    );
  } catch (error) {
    console.error("Error marking notifications as emailed:", error);
  }
};
