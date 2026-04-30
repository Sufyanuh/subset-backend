// cron/dailyEmailJob.js
import cron from "node-cron";
import { sendDailyNotificationEmails } from "../services/dailyNotificationEmailService.js";
import { logger } from "../utils/logger.js";

export const setupDailyEmailCron = () => {
  cron.schedule(
    "30 0 * * *", // 00:30 = 12:30 AM UTC
    async () => {
      console.log(
        "🕐 Running daily notification email cron job for 12:30 AM UTC..."
      );
      logger.cron(
        "🕐 Running daily notification email cron job for 12:30 AM UTC..."
      );

      try {
        const result = await sendDailyNotificationEmails();

        if (result.success) {
          console.log("✅ Daily notification emails sent successfully");
          console.log(
            `📊 Stats: ${result.emailsSent} emails sent, ${result.errors} errors`
          );

          logger.cron("✅ Daily notification emails sent successfully");
          logger.cron(
            `📊 Stats: ${result.emailsSent} emails sent, ${result.errors} errors`
          );
        } else {
          console.error(
            "❌ Failed to send daily notification emails:",
            result.error
          );
          logger.error(
            "❌ Failed to send daily notification emails:",
            result.error
          );
        }
      } catch (error) {
        console.error("❌ Cron job error:", error);
        logger.error("❌ Cron job error:", error);
      }
    },
    {
      timezone: "UTC",
    }
  );

  console.log("📅 Daily email cron job scheduled for 12:30 AM UTC every day");
};
// Manual trigger for testing and admin
export const triggerDailyEmailsNow = async () => {
  console.log("🚀 Manually triggering daily notification emails...");
  return await sendDailyNotificationEmails();
};
