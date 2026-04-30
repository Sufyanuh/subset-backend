// controllers/mailController.js
import { sendEmail } from "../../utils/sendEmail.js";

export const requestCreditsMail = async (req, res) => {
  const { name, projectLink, email, notes, discoverId } = req.body;

  if (!name || !projectLink || !email || !discoverId) {
    return res.status(400).json({
      message: "Name, Email, Project Link and Discover ID are required.",
    });
  }

  try {
    // 🔥 ADMIN EMAIL (notification)
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
          <img src="https://newuser.thesubset.org/assets/images/logo.svg" style="width:120px;" />
        </div>

        <h2 style="text-align:center;color:#333;">🧾 Credit Request (Discover)</h2>

        <p style="color:#555;font-size:15px;">
          A user has requested credit for a Discover item.
        </p>

        <div style="margin: 20px 0; padding: 15px; background: #f9f9f9; border-radius: 8px;">
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Discover ID:</strong> ${discoverId}</p>
          <p><strong>Project Link:</strong> 
            <a href="${projectLink}" target="_blank" style="color:#0077ff;">
              ${projectLink}
            </a>
          </p>
          ${
            notes
              ? `<p><strong>Notes:</strong></p><p style="margin-left:10px;">${notes}</p>`
              : ""
          }
        </div>

        <p style="font-size:13px;color:#888;text-align:center;margin-top:20px;">
          Please verify ownership before assigning credits.
        </p>
      </div>
    `;

    // 🔥 USER EMAIL (confirmation)
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
          <img src="https://newuser.thesubset.org/assets/images/logo.svg" style="width: 120px; margin-bottom: 20px;" />
        </div>

        <h2 style="color: #333; text-align:center;">
          Credit Request Received ✅
        </h2>

        <p style="color: #555; font-size: 15px; text-align:center;">
          Hi ${name}, we've received your request to add credits to a Discover item.
        </p>

        <div style="margin: 20px auto; background: #fff; border-radius: 8px; padding: 15px; border: 1px solid #eee;">
          <p><strong>Your Work:</strong> 
            <a href="${projectLink}" target="_blank" style="color:#0077ff;">
              View Link
            </a>
          </p>
          ${
            notes
              ? `<p><strong>Your Notes:</strong></p><p style="margin-left:10px;">${notes}</p>`
              : ""
          }
        </div>

        <p style="text-align:center;color:#777;font-size:14px;">
          Our team will review your request and update credits if everything checks out.
        </p>

        <p style="color: #aaa; font-size: 12px; text-align:center; margin-top:20px;">
          © ${new Date().getFullYear()} The Subset. All Rights Reserved.
        </p>
      </div>
    `;

    // 🔥 SEND EMAILS
    await sendEmail(
      "contact@thesubset.org",
      "🧾 New Credit Request (Discover)",
      adminEmailContent,
    );

    await sendEmail(
      email,
      "✅ Your credit request has been received",
      userEmailContent,
    );

    return res.json({
      success: true,
      message: "Credit request submitted successfully.",
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
