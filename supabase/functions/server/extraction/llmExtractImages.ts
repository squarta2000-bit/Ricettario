// supabase/functions/server/extraction/llmExtractImages.ts
import type { RecipeDraft } from "./types.ts";
import { DRAFT_SCHEMA, parseDraftResponse } from "./llmShared.ts";
import type { MessagesClient } from "./llmExtract.ts";

export interface ImageInput {
  mediaType: string;
  data: string;
}

const IMAGE_EXTRACTION_INSTRUCTIONS =
  "These photos show a recipe written or printed on paper, possibly spanning multiple photos taken in order. Extract the recipe from them. Identify the title, ingredients (splitting out quantity/unit where possible, always keeping the original line as rawText), the ordered preparation steps, an estimated duration in minutes for each step, and servings. Also identify an overall preparation time and an overall cooking time in minutes, each only if explicitly written (leave null otherwise - never compute these by summing the per-step estimates). Finally, describe the recipe's stated complexity or difficulty level as free text in whatever words are written, in any language, if one is indicated anywhere (leave null if none is stated).";

export async function extractRecipeFromImages(
  images: ImageInput[],
  client: MessagesClient,
): Promise<RecipeDraft> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 16000,
    // See llmExtract.ts: structured-data extraction should be consistent
    // run-to-run, not creative.
    temperature: 0,
    output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: IMAGE_EXTRACTION_INSTRUCTIONS },
          ...images.map((image) => ({
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: image.data },
          })),
        ],
      },
    ],
  });

  return parseDraftResponse(response);
}
