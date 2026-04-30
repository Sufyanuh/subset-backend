import nodemailer from "nodemailer";

// AWS WorkMail SMTP configuration
const transporter = nodemailer.createTransport({
  host: "smtp.mail.us-east-1.awsapps.com", // AWS WorkMail SMTP host
  port: 465, // SSL: 465, TLS: 587
  secure: true, // true for 465, false for 587
  auth: {
    user: "contact@thesubset.org", // your AWS WorkMail email
    pass: "GnKn@o@^2026", // SMTP password
  },
});

export const sendEmail = async (to, subject, htmlContent) => {
  try {
    const info = await transporter.sendMail({
      from: `"The Subset" <contact@thesubset.org>`, // sender
      to, // recipient(s)
      subject,
      html: htmlContent,
    });
    console.log("Email sent:", info.messageId);
    return info;
  } catch (err) {
    console.error("Error sending email via AWS SMTP:", err);
    throw err;
  }
};
