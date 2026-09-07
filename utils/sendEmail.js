import nodemailer from "nodemailer";

// AWS WorkMail SMTP configuration with connection pooling.
// Pooling lets nodemailer reuse connections safely and avoids
// "421 too many commands" errors that occur when a single persistent
// connection is flooded with sequential DATA commands.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.mail.us-east-1.awsapps.com",
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  pool: true,         // enable connection pool
  maxConnections: 3,  // max simultaneous SMTP connections
  maxMessages: 10,    // recycle a connection after 10 messages to avoid stale-connection issues
  rateDelta: 1000,    // rate-limit window in ms
  rateLimit: 3,       // max messages per rateDelta window
  auth: {
    user: process.env.SMTP_USER || "contact@thesubset.org",
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Returns true for transient SMTP errors worth retrying (rate limits, network).
 * Returns false for permanent failures (5xx bad address, auth error, etc.)
 */
export const isTransientSmtpError = (err) => {
  if (err.responseCode >= 500) return false;
  return (
    err.responseCode === 421 ||
    (err.responseCode >= 400 && err.responseCode < 500) ||
    err.code === "ECONNECTION" ||
    err.code === "ETIMEDOUT" ||
    err.code === "ECONNRESET" ||
    err.code === "EENVELOPE"
  );
};

/**
 * Attempt to send a single email — no internal retry logic.
 * Throws on failure so the caller can decide what to do (retry queue, log, etc.)
 */
export const sendEmail = async (to, subject, htmlContent) => {
  const info = await transporter.sendMail({
    from: `"The Subset" <contact@thesubset.org>`,
    to,
    subject,
    html: htmlContent,
  });
  console.log(`Email sent to ${to}:`, info.messageId);
  return info;
};
