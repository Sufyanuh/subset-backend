import bcrypt from "bcryptjs";
import { adminAuth } from "../model/admin.js";

const seedAdmin = async () => {
  try {
    // Check if any admin account already exists
    const adminExists = await adminAuth.findOne({});

    if (adminExists) {
      console.log("Admin account already configured in database");
      return;
    }

    const defaultEmail = process.env.DEFAULT_ADMIN_EMAIL || "admin@subset.com";
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || "12345678";
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const newAdmin = new adminAuth({
      name: "Admin",
      email: defaultEmail.toLowerCase().trim(),
      password: hashedPassword,
      token: null,
    });

    await newAdmin.save();
    console.log(`Default admin created: ${defaultEmail}`);
  } catch (error) {
    console.error("Error seeding admin:", error.message || error);
  }
};

export default seedAdmin;
