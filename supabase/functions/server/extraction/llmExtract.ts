import Anthropic from "npm:@anthropic-ai/sdk";
import type { RecipeDraft } from "./types.ts";

export interface MessagesClient {
  messages: {
    create(params: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    complexity: { type: ["string", "null"] },
    servings: { type: ["string", "null"] },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rawText: { type: "string" },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          name: { type: "string" },
        },
        required: ["rawText", "name"],
        additionalProperties: false,
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          instruction: { type: "string" },
          estimatedMinutes: { type: ["number", "null"] },
        },
        required: ["instruction"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "ingredients", "steps"],
  additionalProperties: false,
};

export async function extractRecipeWithLlm(sourceText: string, client: MessagesClient): Promise<RecipeDraft> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
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

  const textBlock = response.content.find((block) => block.type === "text" && block.text);
  if (!textBlock?.text) throw new Error("No structured output returned");

  try {
    return JSON.parse(textBlock.text) as RecipeDraft;
  } catch (error) {
    throw new Error(
      `Failed to parse LLM structured output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function createAnthropicMessagesClient(apiKey: string): MessagesClient {
  // The real Anthropic SDK client's `messages.create` has a much richer,
  // overloaded signature than the minimal `MessagesClient` interface below
  // (which exists purely so tests can inject a fake). This cast adapts the
  // wider SDK type to that minimal shape; it performs no runtime conversion.
  return new Anthropic({ apiKey }) as unknown as MessagesClient;
}
