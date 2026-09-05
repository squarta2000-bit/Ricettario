import type { MessagesClient } from "./llmExtract.ts";
import type { LlmResponse } from "./llmShared.ts";

const ENRICH_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: { enrichedInstruction: { type: ["string", "null"] } },
        required: ["enrichedInstruction"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
};

interface EnrichmentIngredient {
  rawText: string;
  quantity: number | null;
  unit: string | null;
  name: string;
}

interface EnrichmentStep {
  instruction: string;
}

function formatIngredientForPrompt(ingredient: EnrichmentIngredient): string {
  if (ingredient.rawText.trim().length > 0) return ingredient.rawText.trim();
  const quantity = ingredient.quantity != null ? `${ingredient.quantity} ${ingredient.unit ?? ""} ` : "";
  return `${quantity}${ingredient.name}`.trim();
}

function parseEnrichmentResponse(response: LlmResponse, expectedCount: number): (string | null)[] {
  if (response.stop_reason === "max_tokens") {
    throw new Error("Step enrichment response was truncated (hit max_tokens)");
  }

  const textBlock = response.content.find((block) => block.type === "text" && block.text);
  if (!textBlock?.text) throw new Error("No structured output returned for step enrichment");

  let parsed: { steps?: { enrichedInstruction: string | null }[] };
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (error) {
    throw new Error(
      `Failed to parse step enrichment output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(parsed.steps) || parsed.steps.length !== expectedCount) {
    throw new Error(`Step enrichment returned ${parsed.steps?.length ?? 0} entries, expected ${expectedCount}`);
  }

  return parsed.steps.map((s) => {
    const value = s.enrichedInstruction;
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  });
}

export async function enrichSteps(
  ingredients: EnrichmentIngredient[],
  steps: EnrichmentStep[],
  client: MessagesClient,
): Promise<(string | null)[]> {
  if (steps.length === 0) return [];

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 8000,
    // Rewriting is a mechanical grammar/insertion task, not creative writing -
    // deterministic sampling keeps it consistent run-to-run, same reasoning as llmExtract.ts.
    temperature: 0,
    output_config: { format: { type: "json_schema", schema: ENRICH_SCHEMA } },
    messages: [
      {
        role: "user",
        content:
          "Here is a recipe's ingredient list and its preparation steps. Rewrite ONLY the steps that refer to " +
          "an ingredient or piece of equipment generically - a bare noun or pronoun that omits the quantity or " +
          "defining detail already given in the ingredient list (e.g. \"the pan\", \"the garlic\", \"half the " +
          "butter\"). Expand that reference in place using only the detail already present in the ingredient " +
          "list, keeping the rest of the sentence exactly as it is and the result grammatically correct in the " +
          "same language as the input. Never invent a quantity or detail that isn't in the ingredient list. If " +
          "a step doesn't need this - it's already specific, or it references nothing in the ingredient list - " +
          "return null for it. Return exactly one entry per step, in the same order as the steps below.\n\n" +
          `Ingredients:\n${ingredients.map((i) => `- ${formatIngredientForPrompt(i)}`).join("\n")}\n\n` +
          `Steps:\n${steps.map((s, i) => `${i + 1}. ${s.instruction}`).join("\n")}`,
      },
    ],
  });

  return parseEnrichmentResponse(response, steps.length);
}
