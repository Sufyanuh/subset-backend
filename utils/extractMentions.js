import { User } from "../model/user.js";

export async function extractMentions(title) {
  console.log(title, "<-----title");
  if (!title || typeof title !== 'string' || title.trim() === '') return [];

  try {
    // Extract user IDs directly
    const userIdRegex = /@\[@[^\]]+\]\(([^)]+)\)/g;
    const userIds = [];
    let match;
    
    while ((match = userIdRegex.exec(title)) !== null) {
      if (match[1] && match[1] !== '@everyone') {
        userIds.push(match[1]);
      }
    }

    console.log(userIds, "<-----extracted user IDs");

    // Check for @everyone
    if (title.includes('@everyone') || title.includes('@[@everyone](@everyone)')) {
      // Fetch all users from database
      const allUsers = await User.find({}).select("_id").lean();
      const allUserIds = allUsers.map(user => String(user._id));
      console.log("All user IDs for @everyone:", allUserIds.length);
      return allUserIds;
    }

    // Verify regular users exist
    if (userIds.length === 0) return [];

    const users = await User.find({
      _id: { $in: userIds }
    })
      .select("_id")
      .lean();

    return users.map((user) => String(user._id));
  } catch (error) {
    console.error("Error fetching mentioned users:", error);
    return [];
  }
}