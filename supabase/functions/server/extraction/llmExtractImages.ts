// supabase/functions/server/extraction/llmExtractImages.ts
import type { RecipeDraft } from "./types.ts";
import { DRAFT_SCHEMA, parseDraftResponse } from "./llmShared.ts";
import type { MessagesClient } from "./llmExtract.ts";

export interface ImageInput {
  mediaType: string;
  data: string;
}

const IMAGE_EXTRACTION_INSTRUCTIONS =
  "These photos show a recipe written or printed on paper, possibly spanning multiple photos taken in order. Extract the recipe from them. Identify the title, ingredients (splitting out quantity/unit where possible, always keeping the original line as rawText), the ordered preparation steps, an estimated duration in minutes for each step, servings, and a complexity rating only if stated explicitly.";

export async function extractRecipeFromImages(
  images: ImageInput[],
  client: MessagesClient,
): Promise<RecipeDraft> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 16000,
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
