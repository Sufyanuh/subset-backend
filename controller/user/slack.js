import { User } from "../../model/user.js";
import dotenv from "dotenv";
dotenv.config();
const clientId = process.env.SLACK_CLIENT_ID;
const clientSecret = process.env.SLACK_CLIENT_SECRET;
const redirectUri = process.env.SLACK_REDIRECT_URI;
export const SlackAuthURL = async (req, res) => {
  const slackAuthURL = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=identity.basic,identity.email,identity.avatar&redirect_uri=${redirectUri}`;
  res.redirect(slackAuthURL);
};
export const SlackLogin = async (req, res) => {
  const code = req.query.code;

  try {
    // Exchange code for token
    const tokenRes = await axios.post(
      "https://slack.com/api/oauth.v2.access",
      null,
      {
        params: {
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        },
      }
    );

    const accessToken = tokenRes.data.authed_user.access_token;

    // Fetch user info
    const userRes = await axios.get("https://slack.com/api/users.identity", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const { id, email, name, image_512 } = userRes.data.user;

    // Check if user exists
    let user = await User.findOne({ slackId: id });

    if (!user) {
      user = await User.create({
        slackId: id,
        email,
        username: name,
        fullName: name,
        avatar: image_512,
        accessToken,
      });
    } else {
      // Update access token
      user.accessToken = accessToken;
      await user.save();
    }

    // Generate JWT for session
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    // Send token or redirect
    res.redirect(`https://yourfrontend.com/slack-success?token=${token}`);
  } catch (err) {
    console.error("Slack OAuth error:", err.message);
    res.status(500).send("Slack login failed.");
  }
};
