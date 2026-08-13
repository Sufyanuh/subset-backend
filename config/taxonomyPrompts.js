/**
 * ====================================================================
 * 🎨 SUB•SET TAXONOMY PROMPTS & JSON SCHEMA CONFIGURATION
 * ====================================================================
 * Keep all system prompt templates, rules, and JSON schema definitions
 * isolated here so they can be easily reviewed and edited.
 */

// Fallback category list if MongoDB connection is offline
export const DEFAULT_DISCIPLINES = [
  "Branding",
  "Art Direction",
  "Typography",
  "Photography",
  "3D Animation",
  "UI/UX",
  "Illustration",
  "Advertising",
  "Graphic Design",
  "Fashion",
  "CG",
  "Logo Design",
  "Identity",
  "AI",
  "Experiential",
  "Industrial Design",
  "Product Design",
  "Writing",
  "Architecture",
  "Sound Design",
  "Music",
  "Publication",
  "Packaging",
  "Sculpture",
  "Motion",
  "Film",
  "Painting",
  "Furniture",
  "Textile Art",
  "Lighting",
  "Performance",
  "Culinary",
  "Coding",
  "Gaming",
  "Hair & Makeup",
];

/**
 * Main System Prompt Template for SUB•SET Asset Analysis.
 * Use ${masterListString} to dynamically inject DB Categories.
 */
export const SYSTEM_PROMPT_TEMPLATE = `You are an expert art director, design curator, and creative archivist for SUB•SET—a curated discovery platform for creative talent across advertising, branding, art direction, and design.

Your task is to analyze the provided asset and extract high-level, precise art and design taxonomy for indexing and discovery.

====================================================================
CATEGORY & TAG RULES (CRITICAL)
====================================================================
MASTER LIST OF SUB•SET CATEGORIES & MEDIUMS:
[\${masterListString}]

1. DISCIPLINES (CATEGORIES):
   - Analyze the work and select ALL relevant categories from the Master List above that legitimately apply to this asset. 
   - There is NO LIMIT on the number of disciplines. Include every single category from the Master List that is genuinely represented in the piece.

2. VISUAL TAGS (STRICT RULES):
   - Provide UP TO 10 visual tags maximum.
   - Focus EXCLUSIVELY on descriptive visual properties, aesthetic style, subject matter, mood, color composition, execution details, and type/font classifications.
   - TYPE & TYPOGRAPHY CLASSIFICATION: If typography, lettering, or text is present in the asset, ONLY select font/type terms from this strict allowed list: ["Sans Serif", "Serif", "Handwritten", "Variable"]. Do NOT use any font type outside of this list.
   - STRICT EXCLUSION: Under NO CIRCUMSTANCE should any term from the Master List above (or direct variations of them, e.g. "Logo", "Illustration", "3D") appear inside visual_tags.

Return ONLY a valid JSON object matching this schema:

{
  "disciplines": [
    "Include ALL qualified categories/mediums from the Master List that apply to this work. Select as many as are relevant."
  ],
  "visual_tags": [
    "Provide between 4 and 10 descriptive visual tags representing properties, style, mood, and execution details. If font/type is present, ONLY select from these allowed font types: ['Sans Serif', 'Serif', 'Handwritten', 'Variable']. MAXIMUM 10 TAGS. NEVER include any category terms from the Master List here."
  ],
  "visual_summary": "A concise 1-to-2 sentence editorial description of the work focusing on its artistic concept and execution."
}`;

/**
 * Compiles the system prompt for images or videos dynamically embedding DB category names.
 * @param {Array<string>} dbCategoryNames - Array of active DB category names.
 * @param {'image'|'video'} assetType - Type of asset being analyzed.
 * @returns {string} Fully compiled system prompt string.
 */
export function buildSystemPrompt(dbCategoryNames = [], assetType = "image") {
  const allowedCategories =
    Array.isArray(dbCategoryNames) && dbCategoryNames.length > 0
      ? dbCategoryNames
      : DEFAULT_DISCIPLINES;

  const masterListString = allowedCategories.join(", ");

  let promptText = SYSTEM_PROMPT_TEMPLATE.replace(
    "${masterListString}",
    masterListString
  );

  if (assetType === "video") {
    promptText = promptText.replace(
      "analyze the provided asset",
      "analyze the provided keyframes from this video asset"
    );
  } else {
    promptText = promptText.replace(
      "analyze the provided asset",
      "analyze the provided image asset"
    );
  }

  return promptText;
}

/**
 * Builds OpenAI Structured Output JSON Schema definition.
 * @param {Array<string>} dbCategoryNames - Array of active DB category names.
 * @returns {Object} OpenAI response_format json_schema parameter object.
 */
export function buildTaxonomyJsonSchema(dbCategoryNames = []) {
  const allowedCategories =
    Array.isArray(dbCategoryNames) && dbCategoryNames.length > 0
      ? dbCategoryNames
      : DEFAULT_DISCIPLINES;

  return {
    type: "json_schema",
    json_schema: {
      name: "subset_design_taxonomy",
      strict: true,
      schema: {
        type: "object",
        properties: {
          disciplines: {
            type: "array",
            items: {
              type: "string",
              enum: allowedCategories,
            },
            description:
              "Include ALL qualified categories/mediums from the Master List that apply to this work. Select as many as are relevant.",
          },
          visual_tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Provide between 4 and 10 descriptive visual tags representing properties, style, mood, and execution details. If font/type is present, ONLY select from these allowed font types: ['Sans Serif', 'Serif', 'Handwritten', 'Variable']. MAXIMUM 10 TAGS. NEVER include any category terms from the Master List here.",
          },
          visual_summary: {
            type: "string",
            description:
              "A concise 1-to-2 sentence editorial description of the work focusing on its artistic concept and execution.",
          },
        },
        required: ["disciplines", "visual_tags", "visual_summary"],
        additionalProperties: false,
      },
    },
  };
}
