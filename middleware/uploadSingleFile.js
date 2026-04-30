import multer from "multer";
import multerS3 from "multer-s3";
import { S3Client } from "@aws-sdk/client-s3";
import path from "path";

// 🟩 Configure AWS S3 client
const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// 🟩 Allowed file types
const allowedTypes = /jpeg|jpg|png|gif|webp/;

// 🟩 File filter
const fileFilter = (req, file, cb) => {
  const isValidType =
    allowedTypes.test(file.mimetype) &&
    allowedTypes.test(path.extname(file.originalname).toLowerCase());

  if (isValidType) cb(null, true);
  else
    cb(
      new Error(
        "Invalid file type. Only JPEG, JPG, PNG, GIF, and WebP are allowed."
      )
    );
};

// 🟩 Multer S3 storage configuration (without ACL)
const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${file.originalname.replace(" ", "_")}`;
      cb(null, uniqueName);
    },
  }),
  fileFilter,
  // limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// 🟩 Middleware for single file upload
export const uploadSingleFile = (fieldName) => upload.single(fieldName);
