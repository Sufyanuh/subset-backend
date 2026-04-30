import { sendEmail } from "../../utils/sendEmail.js";

export const ContactUs = async (req, res) => {
  const { email, fullName, Area, Detail } = req.body;

  // Email to admin (you)
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
      <div style="text-align: center;">
        <img src="https://newuser.thesubset.org/assets/images/logo.svg" alt="Logo" style="width: 120px; margin-bottom: 20px;" />
      </div>

      <h2 style="color: #333; text-align:center;">📩 New Contact Form Submission</h2>

      <p style="color: #555; font-size: 15px; line-height: 1.6;">
        You have received a new message from the Contact Us form.
      </p>

      <div style="margin: 20px 0; padding: 15px; background: #f9f9f9; border-radius: 8px;">
        <p><strong>Full Name:</strong> ${fullName}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Area of issue / Subject:</strong> ${Area}</p>
        <p><strong>Message:</strong></p>
        <p style="margin-left: 10px;">${Detail}</p>
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
          Visit Website
        </a>
      </div>

      <p style="color: #888; font-size: 13px; border-top: 1px solid #eee; padding-top: 15px;">
        This email contains the details submitted by the user via the contact form.
      </p>

      <p style="color: #aaa; font-size: 12px; text-align:center; margin-top:20px;">
        © ${new Date().getFullYear()} The Subset. All Rights Reserved.
      </p>
    </div>
  `;

  // Confirmation email to user
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

      <h2 style="color: #333; text-align:center;">Thank you, ${fullName}! 🙌</h2>

      <p style="color: #555; font-size: 15px; line-height: 1.6; text-align:center;">
        We’ve received your message regarding <strong>${Area}</strong> and our team will get back to you as soon as possible.
      </p>

      <div style="margin: 25px auto; width: 90%; background: #fff; border-radius: 8px; padding: 15px; border: 1px solid #eee;">
        <p><strong>Your Message:</strong></p>
        <p style="margin-left: 10px; color:#444;">${Detail}</p>
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
          Visit Our Website
        </a>
      </div>

      <p style="color: #888; font-size: 13px; border-top: 1px solid #eee; padding-top: 15px; text-align:center;">
        If this wasn’t you, please ignore this email. We’re happy to help anytime.
      </p>

      <p style="color: #aaa; font-size: 12px; text-align:center; margin-top:20px;">
        © ${new Date().getFullYear()} The Subset. All Rights Reserved.
      </p>
    </div>
  `;

  try {
    // Send email to admin
    await sendEmail("contact@thesubset.org", "📩 New Contact Form Submission", adminEmailContent);

    // Send confirmation to user
    await sendEmail(email, "✅ We've received your message", userEmailContent);

    return res.json({
      success: true,
      message: "Received",
    });
  } catch (error) {
    console.error(error);

    return res.status(400).json({
      success: false,
      message: "Something went wrong while sending emails.",
      error: error?.message,
    });
  }
};
