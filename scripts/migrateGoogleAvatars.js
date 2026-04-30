// scripts/migrateGoogleAvatars.js

import { User } from "../model/user.js";
import { uploadGoogleImageViaPresignedUrl } from "../utils/googleImageUpload.js";

export const migrateExistingGoogleAvatars = async () => {
  try {
    const users = await User.find({
      avatar: { $regex: 'googleusercontent.com', $options: 'i' }
    });

    console.log(`Found ${users.length} users with Google avatars`);

    for (const user of users) {
      try {
        console.log(`🔄 Migrating avatar for: ${user.email}`);
        
        const fileName = `migrated-google-avatar-${user._id}-${Date.now()}.jpg`;
        const s3Url = await uploadGoogleImageViaPresignedUrl(user.avatar, fileName);
        
        if (s3Url) {
          user.avatar = s3Url;
          await user.save();
          console.log(`✅ Successfully migrated: ${user.email}`);
        } else {
          console.log(`❌ Failed to migrate: ${user.email}`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`❌ Error migrating ${user.email}:`, error.message);
      }
    }

    console.log('🎉 Migration completed!');
  } catch (error) {
    console.error('Migration failed:', error);
  }
};