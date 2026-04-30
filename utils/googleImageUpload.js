// utils/googleImageUpload.js
import axios from "axios";

export const uploadGoogleImageViaPresignedUrl = async (
  googleImageUrl,
  fileName
) => {
  try {
    // Step 1: Get presigned URL from your backend
    const presignResponse = await axios.get("http://localhost:8116/api/upload/presign", {
      params: {
        fileName: fileName,
        fileType: "image/jpeg",
      },
    });

    const { uploadURL, fileURL } = presignResponse.data;

    // Step 2: Download image from Google
    const googleResponse = await axios({
      method: "GET",
      url: googleImageUrl,
      responseType: "arraybuffer",
    });

    // Step 3: Upload directly to S3 using presigned URL
    await axios.put(uploadURL, googleResponse.data, {
      headers: {
        "Content-Type": "image/jpeg",
      },
    });

    console.log("✅ Google image uploaded to S3 via presigned URL");
    return fileURL;
  } catch (error) {
    console.error("Error uploading Google image via presigned URL:", error);
    return null;
  }
};
