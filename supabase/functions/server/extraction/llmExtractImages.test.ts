// supabase/functions/server/extraction/llmExtractImages.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractRecipeFromImages, type ImageInput } from "./llmExtractImages.ts";
import type { MessagesClient } from "./llmExtract.ts";

function capturingClient(draftJson: Record<string, unknown>): { client: MessagesClient; getLastParams: () => Record<string, unknown> } {
  let lastParams: Record<string, unknown> = {};
  const client: MessagesClient = {
    messages: {
      create: async (params) => {
        lastParams = params;
        return { content: [{ type: "text", text: JSON.stringify(draftJson) }] };
      },
    },
  };
  return { client, getLastParams: () => lastParams };
}

Deno.test("sends one text instruction block followed by an image block per photo", async () => {
  const images: ImageInput[] = [
    { mediaType: "image/jpeg", data: "aaa" },
    { mediaType: "image/jpeg", data: "bbb" },
  ];
  const { client, getLastParams } = capturingClient({
    title: "Photo Soup",
    complexity: null,
    servings: null,
    ingredients: [],
    steps: [],
  });

  const draft = await extractRecipeFromImages(images, client);

  assertEquals(draft.title, "Photo Soup");
  const params = getLastParams();
  const messages = params.messages as Array<{ content: Array<Record<string, unknown>> }>;
  const content = messages[0].content;
  assertEquals(content.length, 3);
  assertEquals(content[0].type, "text");
  assertEquals(content[1], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aaa" } });
  assertEquals(content[2], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "bbb" } });
  assertEquals(params.temperature, 0);
});
