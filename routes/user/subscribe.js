import express from "express";
import mailchimp from "@mailchimp/mailchimp_marketing";
import dotenv from "dotenv";
import { sendEmail } from "../../utils/sendEmail.js";

dotenv.config();
export const subscribeRoute = express.Router();

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_SERVER_PREFIX || "us12",
});

const AUDIENCE_ID = process.env.MAILCHIMP_AUDIENCE_ID;
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "contact@thesubset.org";
console.log(
  AUDIENCE_ID,
  CONTACT_EMAIL,
  process.env.MAILCHIMP_API_KEY,
  "mailchimp key"
);
subscribeRoute.post("/", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Email is required" });
  }

  const userEmailContent = `
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

      <h2 style="color: #333; text-align:center;">🎉 Newsletter Subscription Successful</h2>

      <p style="color: #555; font-size: 15px; line-height: 1.6;">
        Thank you for subscribing to our newsletter! <br/>
        We'll keep you updated with the latest news, offers, and important updates.
      </p>

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
        If you did not subscribe or believe this was a mistake, simply ignore this email.
      </p>

      <p style="color: #aaa; font-size: 12px; text-align:center; margin-top:20px;">
        © ${new Date().getFullYear()} The Subset. All Rights Reserved.
      </p>
    </div>
  `;

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
      <h2 style="color: #333;">📩 New Newsletter Subscriber</h2>

      <p style="color: #555; font-size: 15px;">
        A new user just subscribed to your newsletter.
      </p>

      <p style="font-size: 16px; font-weight: bold;">Email: ${email}</p>

      <p style="color: #aaa; font-size: 12px; margin-top: 20px;">
        © ${new Date().getFullYear()} The Subset.
      </p>
    </div>
  `;

  try {
    const subscriberHash = email.toLowerCase().trim();

    // Check if already subscribed
    const memberInfo = await mailchimp.lists
      .getListMember(AUDIENCE_ID, subscriberHash)
      .catch(() => null);

    if (memberInfo && memberInfo.status === "subscribed") {
      return res
        .status(200)
        .json({ success: true, message: "Already subscribed" });
    }

    // Add or update subscriber
    await mailchimp.lists.setListMember(AUDIENCE_ID, subscriberHash, {
      email_address: email,
      status_if_new: "subscribed",
    });

    // Send confirmation email to the user
    await sendEmail(
      email,
      "Newsletter Subscription Successful",
      userEmailContent
    );

    // Send notification email to contact/admin
    await sendEmail(
      CONTACT_EMAIL,
      "New Newsletter Subscriber",
      adminEmailContent
    );

    return res.json({ success: true, message: "Subscribed successfully" });
  } catch (error) {
    console.error("Mailchimp Error:", error.response?.text || error.message);

    let errMsg = "Something went wrong while subscribing.";

    if (error?.response?.text) {
      try {
        const parsed = JSON.parse(error.response.text);
        errMsg = parsed.detail || parsed.title || errMsg;
      } catch {
        errMsg = error.message;
      }
    }

    return res.status(400).json({
      success: false,
      message: errMsg.replace("Member", "Subscriber"),
    });
  }
});
