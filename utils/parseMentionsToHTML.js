export const parseMentionsToHTML = (text) => {
  if (!text) return "";

  // Rich text: bold (**text**) and underline (__text__)
  let parsedText = text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<u>$1</u>");

  // Replace user mentions: @[username](userId)
  parsedText = parsedText.replace(
    /\[@([^\]]+)\]\(([^)]+)\)/g,
    (_, display, id) => {
      if (id === "@everyone") {
        // special case for @everyone
        return `<span data-userid="#">everyone </span>`;
      }
      return `<span data-userid="${display}">${display} </span>`;
    }
  );

  return parsedText;
};
