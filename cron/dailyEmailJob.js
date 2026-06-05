// cron/dailyEmailJob.js
import cron from "node-cron";
import { sendDailyNotificationEmails } from "../services/dailyNotificationEmailService.js";
import { logger } from "../utils/logger.js";
import { sendEmail } from "../utils/sendEmail.js";

const ADMIN_EMAIL = "sufyanulhaq283@gmail.com";

const notifyAdmin = async (subject, html) => {
  try {
    await sendEmail(ADMIN_EMAIL, subject, html);
  } catch (err) {
    logger.error(`❌ Failed to send admin notification email: ${err.message}`);
  }
};

export const setupDailyEmailCron = () => {
  cron.schedule(
    "30 0 * * *", // 00:30 = 12:30 AM UTC
    async () => {
      const startedAt = new Date();
      const startedAtStr = startedAt.toUTCString();

      console.log("🕐 Running daily notification email cron job for 12:30 AM UTC...");
      logger.cron("🕐 Running daily notification email cron job for 12:30 AM UTC...");

      // ── Notify admin: cron started ─────────────────────────────────────────
      await notifyAdmin(
        "🕐 Daily Email Cron Started",
        `<p>The daily notification email cron job has <strong>started</strong>.</p>
         <p><strong>Started at:</strong> ${startedAtStr}</p>`
      );

      try {
        const result = await sendDailyNotificationEmails();
        const finishedAt = new Date();
        const durationSec = ((finishedAt - startedAt) / 1000).toFixed(1);

        if (result.success) {
          console.log("✅ Daily notification emails sent successfully");
          console.log(`📊 Stats: ${result.emailsSent} emails sent, ${result.errors} errors`);
          logger.cron("✅ Daily notification emails sent successfully");
          logger.cron(`📊 Stats: ${result.emailsSent} emails sent, ${result.errors} errors`);

          // ── Notify admin: cron finished successfully ───────────────────────
          await notifyAdmin(
            "✅ Daily Email Cron Completed",
            `<p>The daily notification email cron job has <strong>completed successfully</strong>.</p>
             <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
               <tr><td style="padding:6px 12px;font-weight:bold;">Started at</td><td style="padding:6px 12px;">${startedAtStr}</td></tr>
               <tr><td style="padding:6px 12px;font-weight:bold;">Finished at</td><td style="padding:6px 12px;">${finishedAt.toUTCString()}</td></tr>
               <tr><td style="padding:6px 12px;font-weight:bold;">Duration</td><td style="padding:6px 12px;">${durationSec}s</td></tr>
               <tr><td style="padding:6px 12px;font-weight:bold;">Total users</td><td style="padding:6px 12px;">${result.totalUsers}</td></tr>
               <tr><td style="padding:6px 12px;font-weight:bold;">Emails sent</td><td style="padding:6px 12px;">${result.emailsSent}</td></tr>
               <tr><td style="padding:6px 12px;font-weight:bold;">Errors</td><td style="padding:6px 12px;">${result.errors}</td></tr>
             </table>`
          );
        } else {
          console.error("❌ Failed to send daily notification emails:", result.error);
          logger.error("❌ Failed to send daily notification emails:", result.error);

          // ── Notify admin: cron finished with failure ───────────────────────
          await notifyAdmin(
            "❌ Daily Email Cron Failed",
            `<p>The daily notification email cron job <strong>failed</strong>.</p>
             <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
               <tr><td style="padding:6px 12px;font-weight:bold;">Started at</td><td style="padding:6px 12px;">${startedAtStr}</td></tr>
               <tr><td style="padding:6px 12px;font-weight:bold;">Finished at</td><td style="padding:6px 12px;">${finishedAt.toUTCString()}</td></tr>
               <tr><td style="padding:6px 12px;font-weight:bold;">Duration</td><td style="padding:6px 12px;">${durationSec}s</td></tr>
               <tr><td style="padding:6px 12px;font-weight:bold;">Error</td><td style="padding:6px 12px;color:red;">${result.error}</td></tr>
             </table>`
          );
        }
      } catch (error) {
        const finishedAt = new Date();
        console.error("❌ Cron job error:", error);
        logger.error("❌ Cron job error:", error);

        // ── Notify admin: unexpected crash ─────────────────────────────────
        await notifyAdmin(
          "💥 Daily Email Cron Crashed",
          `<p>The daily notification email cron job <strong>crashed unexpectedly</strong>.</p>
           <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
             <tr><td style="padding:6px 12px;font-weight:bold;">Started at</td><td style="padding:6px 12px;">${startedAtStr}</td></tr>
             <tr><td style="padding:6px 12px;font-weight:bold;">Crashed at</td><td style="padding:6px 12px;">${finishedAt.toUTCString()}</td></tr>
             <tr><td style="padding:6px 12px;font-weight:bold;">Error</td><td style="padding:6px 12px;color:red;">${error.message}</td></tr>
             <tr><td style="padding:6px 12px;font-weight:bold;">Stack</td><td style="padding:6px 12px;font-size:12px;color:#555;">${error.stack?.replace(/\n/g, "<br/>") ?? "N/A"}</td></tr>
           </table>`
        );
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
