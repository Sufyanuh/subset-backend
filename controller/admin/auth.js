import bcrypt from "bcryptjs"; // Import bcrypt
import { adminAuth } from "../../model/admin.js";
import { generateAuthToken } from "../../services/generateJwt.js";

export const loginAdmin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const admin = await adminAuth.findOne({ email });
    if (!admin) {
      return res.status(400).json({ message: "Invalid Email" });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid Password" });
    }
    const data = admin.toObject();
    delete data.token;
    const token = generateAuthToken(data);
    admin.token = token;

    await admin.save();

    res.status(200).json({ message: "Login successfully", data: admin });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ message: errors.message, error: errors });
  }
};
