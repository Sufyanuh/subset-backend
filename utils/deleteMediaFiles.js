import path from "path";
import fs from "fs";
export const deleteMediaFiles = (mediaArray) => {
  mediaArray.forEach((item) => {
    if (item?.url) {
      const filePath = `../..${item.url}`;
      fs.unlink(filePath, (err) => {
        if (err && err.code !== "ENOENT") {
          console.error(`❌ Error 2 deleting file ${filePath}:`, err.message);
        }
      });
      console.log(filePath, "<======filePath");
    }
  });
};
