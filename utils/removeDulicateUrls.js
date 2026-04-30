export const removeDuplicatesByUrl = (files) => {
  const seen = new Set();
  return files.filter((file) => {
    if (seen.has(file.url)) return false;
    seen.add(file.url);
    return true;
  });
};
