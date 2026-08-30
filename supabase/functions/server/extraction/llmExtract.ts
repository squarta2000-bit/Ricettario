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
    // This is structured-data extraction, not creative writing - a low
    // temperature keeps runs consistent (e.g. reliably reading a
    // "Preparazione | Cottura | Totale" time table into the right fields)
    // instead of the default sampling temperature occasionally omitting
    // values it could have read directly off the page.
    temperature: 0,
    output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
    messages: [
      {
        role: "user",
        content:
          "Extract the recipe from the following text. Identify the title, ingredients (splitting out quantity/unit where possible, always keeping the original line as rawText), the ordered preparation steps, an estimated duration in minutes for each step, and servings. Also identify an overall preparation time and an overall cooking time in minutes, each only if the source explicitly states them (leave null otherwise - never compute these by summing the per-step estimates). Finally, describe the recipe's stated complexity or difficulty level as free text in whatever words the source itself uses, in any language, if the source indicates one anywhere at all (leave null if none is stated).\n\n" +
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
