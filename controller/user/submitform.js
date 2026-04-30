// controllers/mailController.js
import { sendEmail } from "../../utils/sendEmail.js";

export const sumbitworkMail = async (req, res) => {
  const { name, projectLink, email, credits, notes } = req.body;

  if (!name || !projectLink || !email) {
    return res.status(400).json({ message: "Required fields are missing." });
  }

  try {
    // Admin email (notification)
    const adminEmailContent = `
      <div style="
        max-width: 600px;
        margin: auto;
        padding: 20px;
        font-family: Arial, sans-serif;
        background: #ffffff;
        border-radius: 10px;
        border: 1px solid #eee;
      ">
        <div style="text-align:center;margin-bottom:20px;">
          <img src="https://newuser.thesubset.org/assets/images/logo.svg" alt="Logo" style="width:120px;" />
        </div>

        <h2 style="text-align:center;color:#333;">🎨 New Work Submission</h2>

        <p style="color:#555;font-size:15px;line-height:1.6;">
          A new work has been submitted via the website.
        </p>

        <div style="margin: 20px 0; padding: 15px; background: #f9f9f9; border-radius: 8px;">
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Project Link:</strong> <a href="${projectLink}" target="_blank" style="color:#0077ff;">${projectLink}</a></p>
          ${credits ? `<p><strong>Credits:</strong> ${credits}</p>` : ""}
          ${
            notes
              ? `<p><strong>Notes:</strong></p><p style="margin-left:10px;">${notes}</p>`
              : ""
          }
        </div>

        <div style="text-align:center;margin-top:25px;">
          <a href="https://newuser.thesubset.org/" style="
            display:inline-block;
            padding:12px 22px;
            background:#0077ff;
            color:white;
            text-decoration:none;
            border-radius:6px;
            font-weight:bold;
          ">
            Visit Website
          </a>
        </div>

        <p style="color:#888;font-size:13px;border-top:1px solid #eee;padding-top:15px;text-align:center;margin-top:20px;">
          © ${new Date().getFullYear()} The Subset. All Rights Reserved.
        </p>
      </div>
    `;

    // User confirmation email
    const userEmailContent = `
      <div style="
        max-width: 600px;
        margin: auto;
        padding: 25px;
        font-family: Arial, sans-serif;
        background: #fafafa;
        border-radius: 10px;
        border: 1px solid #eee;
      ">
        <div style="text-align: center;">
          <img src="https://newuser.thesubset.org/assets/images/logo.svg" alt="Logo" style="width: 120px; margin-bottom: 20px;" />
        </div>

        <h2 style="color: #333; text-align:center;">Thank you, ${name}! 🎉</h2>

        <p style="color: #555; font-size: 15px; line-height: 1.6; text-align:center;">
          We've received your project submission and our editorial team will review it soon.
        </p>

        <div style="margin: 25px auto; width: 90%; background: #fff; border-radius: 8px; padding: 15px; border: 1px solid #eee;">
          <p><strong>Project Link:</strong> <a href="${projectLink}" target="_blank" style="color:#0077ff;">${projectLink}</a></p>
          ${credits ? `<p><strong>Credits:</strong> ${credits}</p>` : ""}
          ${
            notes
              ? `<p><strong>Your Notes:</strong></p><p style="margin-left:10px;">${notes}</p>`
              : ""
          }
        </div>

        <div style="margin: 25px 0; text-align:center;">
          <a href="https://newuser.thesubset.org/"
            style="
              display: inline-block;
              padding: 12px 22px;
              background: #0077ff;
              color: white;
              text-decoration: none;
              border-radius: 6px;
              font-weight: bold;
            ">
            Visit The Subset
          </a>
        </div>

        <p style="color: #888; font-size: 13px; border-top: 1px solid #eee; padding-top: 15px; text-align:center;">
          You'll receive another email once our team reviews your submission.
        </p>

        <p style="color: #aaa; font-size: 12px; text-align:center; margin-top:20px;">
          © ${new Date().getFullYear()} The Subset. All Rights Reserved.
        </p>
      </div>
    `;

    // Send emails
    await sendEmail("contact@thesubset.org", "🎨 New Work Submission", adminEmailContent);
    await sendEmail(email, "✅ We've received your project submission", userEmailContent);

    return res.json({
      success: true,
      message: "Work submitted successfully. Confirmation email sent to user.",
    });
  } catch (error) {
    console.error("Mail Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send email.",
      error: error.message,
    });
  }
};
