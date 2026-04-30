import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { User } from "../../model/user.js";
import { generateAuthToken } from "../../services/generateJwt.js";
import { generateUsername } from "../../utils/generateUsername.js";
import { sendEmail } from "../../utils/sendEmail.js";
import { uploadGoogleImageViaPresignedUrl } from "../../utils/googleImageUpload.js";

dotenv.config();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

export const getUser = async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(401).json({ message: "Missing auth token." });
  }

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    res.status(200).json({ message: "User Found", data: user });
  } catch (errors) {
    console.error("Error fetching user:", errors);
    res.status(500).json({ message: errors.message, errors });
  }
};

export const registerUser = async (req, res) => {
  const { fullName, email, password } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const normalizedEmail = email.toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Create user FIRST
    const user = new User({
      fullName,
      email: normalizedEmail,
      username: await generateUsername(normalizedEmail),
      password,
      isActive: false,
    });

    await user.save();

    // Generate verification token
    const verifyOtp = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    const verifyUrl = `https://thesubset.org/verifyEmail?token=${verifyOtp}`;

    const emailContent = emailVerificationTemplate(fullName, verifyUrl);

    await sendEmail(user.email, "Verify Your Email", emailContent);

    res.status(201).json({
      success: true,
      message: "Verification link has been sent to your email",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: "Token is required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isActive) {
      return res.status(400).json({ message: "Email already verified" });
    }

    user.isActive = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (err) {
    res.status(500).json({ message: "Invalid or expired token" });
  }
};

export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const normalizedEmail = String(email).toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(400).json({ message: "Invalid Email" });
    }
    if (!user.isActive) {
      const verifyOtp = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
        expiresIn: "15m",
      });

      const verifyUrl = `https://newuser.thesubset.org/verifyEmail?token=${verifyOtp}`;

      const emailContent = emailVerificationTemplate(user.fullName, verifyUrl);
      await sendEmail(user.email, "Verify Your Email", emailContent);

      return res.status(400).json({
        message:
          "Your account is not active yet. A verification email has been sent—please check your inbox.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid Password" });
    }
    const data = user.toObject();
    delete data.token;
    const token = generateAuthToken(data);
    user.token = token;

    await user.save();

    res.status(200).json({ message: "Login successfully", data: user });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ message: errors.message, error: errors });
  }
};

export const forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const normalizedEmail = String(email).toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ message: "No user found with this email" });
    }

    const resetToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    const resetLink = `https://thesubset.org/reset-password?token=${resetToken}`;

    const emailContent = `
      <h2>Password Reset Request</h2>
      <p>Click the link below to reset your password. This link will expire in 15 minutes.</p>
      <a href="${resetLink}">${resetLink}</a>
    `;

    await sendEmail(user.email, "Reset Your Password", emailContent);

    return res.status(200).json({
      message: "Password reset link sent to your email.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

export const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({ message: "Invalid or expired token" });
    }

    user.password = newPassword;
    await user.save();

    return res.status(200).json({ message: "Password reset successful" });
  } catch (err) {
    return res.status(400).json({ message: "Invalid or expired token" });
  }
};

export const loginWithGoogle = async (req, res) => {
  const { email, name, picture, sub, given_name, family_name } = req.body;

  try {
    if (!email) {
      return res
        .status(400)
        .json({ message: "Google account must have an email" });
    }

    const normalizedEmail = String(email).toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      // Create new user - upload Google image to S3 via presigned URL
      const username = await generateUsername(normalizedEmail);

      let avatarUrl = picture;

      // Upload Google image to S3 for new users
      if (picture && picture.includes("googleusercontent.com")) {
        const fileName = `google-avatar-${sub}-${Date.now()}.jpg`;
        const s3AvatarUrl = await uploadGoogleImageViaPresignedUrl(
          picture,
          fileName
        );
        if (s3AvatarUrl) {
          avatarUrl = s3AvatarUrl;
          console.log(`✅ Uploaded Google image to S3 for new user: ${email}`);
        }
      }

      user = new User({
        email: normalizedEmail,
        fullName: name,
        username,
        avatar: avatarUrl,
        password: Math.random().toString(36).slice(-8),
        isActive: true,
      });
    } else {
      // Existing user - update avatar if it's still from Google
      if (user.avatar && user.avatar.includes("googleusercontent.com")) {
        const fileName = `google-avatar-${user._id}-${Date.now()}.jpg`;
        const s3AvatarUrl = await uploadGoogleImageViaPresignedUrl(
          picture,
          fileName
        );
        if (s3AvatarUrl) {
          user.avatar = s3AvatarUrl;
          console.log(
            `✅ Updated Google image to S3 for existing user: ${email}`
          );
        }
      }

      user.isActive = true;
    }

    const data = user.toObject();
    delete data.token;
    const token = generateAuthToken(data);
    user.token = token;
    await user.save();

    res.status(200).json({
      message: "Logged In successfully",
      data: user,
    });
  } catch (err) {
    console.error("Google login error:", err);
    res.status(500).json({
      message: "Google login failed",
      error: err.message,
    });
  }
};

export const emailVerificationTemplate = (name, link) => {
  return `
  <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
    <h2>Welcome, ${name} 👋</h2>
    <p>Thanks for registering on <strong>The Subset</strong>.</p>

    <p>Please verify your email by clicking the button below:</p>

    <a href="${link}" 
      style="
        display: inline-block;
        padding: 12px 20px;
        background: black;
        color: white;
        text-decoration: none;
        border-radius: 6px;
        margin-top: 12px;
      "
    >
      Verify Email
    </a>

    <p style="margin-top: 30px; font-size: 14px; color: #888;">
      If the button doesn't work, copy & paste this link in your browser:<br>
      <span style="color:#0066cc;">${link}</span>
    </p>

    <p style="margin-top: 30px;">Regards,<br>The Subset Team</p>
  </div>
  `;
};
