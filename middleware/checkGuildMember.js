import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const GUILD_ID = process.env.DISCORD_GUILD_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

export const checkGuildMembership = async (req, res, next) => {
  try {
    const rawCookie = req.cookies?.auth_token;

    if (!rawCookie) {
      return res.status(401).json({ message: "Missing auth token." });
    }

    const parsedUser = JSON.parse(rawCookie); // parse the JSON string
    const discordId = parsedUser.discordId;

    if (!discordId) {
      return res.status(401).json({ message: "Discord ID missing in token." });
    }

    const url = `https://discord.com/api/guilds/${GUILD_ID}/members/${discordId}`;
    const headers = { Authorization: `Bot ${BOT_TOKEN}` };

    const response = await axios.get(url, { headers });

    if (response.status === 200) {
      req.discordUser = response.data;
      next();
    } else {
      return res
        .status(403)
        .json({ message: "User is not in the Discord guild." });
    }
  } catch (error) {
    if (error.response?.status === 404) {
      return res
        .status(403)
        .json({ message: "User is not in the Discord guild." });
    }

    console.error("Guild check failed:", error.response?.data || error.message);
    return res.status(500).json({
      message: "Internal server error while checking guild membership.",
    });
  }
};
