import type { RecipeDraft } from "./types.ts";

export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    complexity: { type: ["string", "null"] },
    servings: { type: ["string", "null"] },
    prepMinutes: { type: ["number", "null"] },
    cookMinutes: { type: ["number", "null"] },
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

export interface LlmResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string;
}

export function parseDraftResponse(response: LlmResponse): RecipeDraft {
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "LLM response was truncated (hit max_tokens) — the recipe may be too long to extract in one call",
    );
  }

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
