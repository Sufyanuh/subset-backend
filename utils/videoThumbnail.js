/**
 * Helper to resolve thumbnail URL for video URLs (YouTube, Vimeo, etc.)
 */
export const resolveVideoThumbnail = async (url, sourceType) => {
  if (!url) return "";
  const sType = (sourceType || "").toLowerCase();

  // YouTube
  if (sType === "youtube" || url.includes("youtube.com") || url.includes("youtu.be")) {
    const ytMatch = url.match(/(?:embed\/|v=|vi\/|youtu\.be\/|\/v\/)([a-zA-Z0-9_-]{11})/);
    const ytId = ytMatch ? ytMatch[1] : url.split("/").pop().split("?")[0];
    if (ytId) {
      return `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`;
    }
  }

  // Vimeo
  if (sType === "vimeo" || url.includes("vimeo.com")) {
    const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?([0-9]+)/);
    const vimeoId = vimeoMatch ? vimeoMatch[1] : null;
    if (vimeoId) {
      try {
        const oembedUrl = `https://vimeo.com/api/oembed.json?url=https://vimeo.com/${vimeoId}&width=1280`;
        const res = await fetch(oembedUrl);
        if (res.ok) {
          const data = await res.json();
          if (data.thumbnail_url) return data.thumbnail_url;
        }
      } catch (err) {
        console.error("Error fetching Vimeo oembed thumbnail:", err.message);
      }
      return `https://vumbnail.com/${vimeoId}.jpg`;
    }
  }

  return "";
};
