import bcrypt from "bcryptjs"; // Import bcrypt
import { adminAuth } from "../../model/admin.js";
import { generateAuthToken } from "../../services/generateJwt.js";

export const loginAdmin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const admin = await adminAuth.findOne({ email: email.toLowerCase().trim() });
    if (!admin) {
      return res.status(400).json({ message: "Invalid Email" });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid Password" });
    }
    const data = admin.toObject();
    delete data.token;
    delete data.password;
    const token = generateAuthToken(data);
    admin.token = token;

    await admin.save();

    res.status(200).json({
      message: "Login successfully",
      data: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        avatar: admin.avatar || "",
        token: token,
      },
    });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ message: errors.message, error: errors });
  }
};

// 👤 Get Admin Profile
export const getAdminProfile = async (req, res) => {
  try {
    const adminId = req.user?._id || req.user?.id;
    if (!adminId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const admin = await adminAuth.findById(adminId).select("-password -token");
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    res.status(200).json({ message: "Profile fetched successfully", data: admin });
  } catch (error) {
    console.error("Error fetching admin profile:", error);
    res.status(500).json({ message: error.message || "Failed to fetch profile" });
  }
};

// ✏️ Update Admin Profile & Change Password & Avatar
export const updateAdminProfile = async (req, res) => {
  try {
    const adminId = req.user?._id || req.user?.id;
    if (!adminId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { name, email, avatar, currentPassword, newPassword } = req.body;

    const admin = await adminAuth.findById(adminId);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Check if new password is requested
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ message: "Current password is required to set a new password." });
      }

      const isCurrentMatch = await bcrypt.compare(currentPassword, admin.password);
      if (!isCurrentMatch) {
        return res.status(400).json({ message: "Incorrect current password." });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters long." });
      }

      admin.password = await bcrypt.hash(newPassword, 10);
    }

    if (name) {
      admin.name = name.trim();
    }

    if (avatar !== undefined) {
      admin.avatar = avatar;
    }

    if (email) {
      const normalizedEmail = email.toLowerCase().trim();
      if (normalizedEmail !== admin.email) {
        const emailTaken = await adminAuth.findOne({
          email: normalizedEmail,
          _id: { $ne: adminId },
        });
        if (emailTaken) {
          return res.status(400).json({ message: "Email is already in use by another admin." });
        }
        admin.email = normalizedEmail;
      }
    }

    const data = admin.toObject();
    delete data.token;
    delete data.password;
    const newToken = generateAuthToken(data);
    admin.token = newToken;

    await admin.save();

    res.status(200).json({
      message: "Admin profile updated successfully",
      data: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        avatar: admin.avatar || "",
        token: newToken,
      },
    });
  } catch (error) {
    console.error("Error updating admin profile:", error);
    res.status(500).json({ message: error.message || "Failed to update admin profile" });
  }
};
