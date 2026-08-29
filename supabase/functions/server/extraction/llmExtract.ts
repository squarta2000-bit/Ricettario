import Anthropic from "npm:@anthropic-ai/sdk";
import type { RecipeDraft } from "./types.ts";
import { DRAFT_SCHEMA, parseDraftResponse, type LlmResponse } from "./llmShared.ts";

export interface MessagesClient {
  messages: {
    create(params: Record<string, unknown>): Promise<LlmResponse>;
  };
}

export async function extractRecipeWithLlm(sourceText: string, client: MessagesClient): Promise<RecipeDraft> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
    messages: [
      {
        role: "user",
        content:
          "Extract the recipe from the following text. Identify the title, ingredients (splitting out quantity/unit where possible, always keeping the original line as rawText), the ordered preparation steps, an estimated duration in minutes for each step, servings, and a complexity rating only if the source text states one explicitly.\n\n" +
          sourceText,
      },
    ],
  });

  return parseDraftResponse(response);
}

export function createAnthropicMessagesClient(apiKey: string): MessagesClient {
  // The real Anthropic SDK client's `messages.create` has a much richer,
  // overloaded signature than the minimal `MessagesClient` interface below
  // (which exists purely so tests can inject a fake). This cast adapts the
  // wider SDK type to that minimal shape; it performs no runtime conversion.
  return new Anthropic({ apiKey }) as unknown as MessagesClient;
}
