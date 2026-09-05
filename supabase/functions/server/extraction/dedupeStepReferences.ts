import type { MessagesClient } from "./llmExtract.ts";
import type { LlmResponse } from "./llmShared.ts";

const DEDUPE_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: { instruction: { type: "string" } },
        required: ["instruction"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
};

interface DedupeIngredient {
  rawText: string;
  quantity: number | null;
  unit: string | null;
  name: string;
}

function formatIngredientForPrompt(ingredient: DedupeIngredient): string {
  if (ingredient.rawText.trim().length > 0) return ingredient.rawText.trim();
  const quantity = ingredient.quantity != null || ingredient.unit != null
    ? `${ingredient.quantity ?? ""} ${ingredient.unit ?? ""} `
    : "";
  return `${quantity}${ingredient.name}`.trim();
}

function parseDedupeResponse(response: LlmResponse, expectedCount: number): string[] {
  if (response.stop_reason === "max_tokens") {
    throw new Error("Step de-duplication response was truncated (hit max_tokens)");
  }

  const textBlock = response.content.find((block) => block.type === "text" && block.text);
  if (!textBlock?.text) throw new Error("No structured output returned for step de-duplication");

  let parsed: { steps?: { instruction: string }[] };
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (error) {
    throw new Error(
      `Failed to parse step de-duplication output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(parsed.steps) || parsed.steps.length !== expectedCount) {
    throw new Error(`Step de-duplication returned ${parsed.steps?.length ?? 0} entries, expected ${expectedCount}`);
  }

  return parsed.steps.map((s) => s.instruction);
}

export async function dedupeStepReferences(
  ingredients: DedupeIngredient[],
  instructions: string[],
  client: MessagesClient,
): Promise<string[]> {
  if (instructions.length === 0) return [];

  const promptContent =
    "Here is a recipe's ingredient list and its preparation steps, already rewritten so ingredient/equipment " +
    "references are fully specific. Some ingredients are mentioned in more than one step, each time repeating " +
    "their full quantity/detail verbatim. Like a human recipe writer: the FIRST mention of each ingredient " +
    "across the whole list of steps should stay fully specific and unchanged. Every mention AFTER that first " +
    "one should be shortened to a brief, natural reference instead (e.g. \"les pommes de terre\" instead of " +
    "repeating \"1,3 kg de pommes de terre Mona Lisa\", \"le plat\" instead of repeating \"le plat de 20 cm " +
    "sur 30 cm\"). Never touch a step's first, original mention of any given ingredient. Never change anything " +
    "else about a step's wording. If a step needs no shortening at all, return its text completely unchanged. " +
    "Keep the same language as the input. Return exactly one entry per step, in the same order as the steps " +
    "below.\n\n" +
    `Ingredients:\n${ingredients.map((i) => `- ${formatIngredientForPrompt(i)}`).join("\n")}\n\n` +
    `Steps:\n${instructions.map((text, i) => `${i + 1}. ${text}`).join("\n")}`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 8000,
    // Trimming repeats is a mechanical rewrite task, not creative writing -
    // deterministic sampling keeps it consistent run-to-run, same reasoning
    // as enrichSteps.ts/llmExtract.ts.
    temperature: 0,
    output_config: { format: { type: "json_schema", schema: DEDUPE_SCHEMA } },
    messages: [{ role: "user", content: promptContent }],
  });

  return parseDedupeResponse(response, instructions.length);
}
