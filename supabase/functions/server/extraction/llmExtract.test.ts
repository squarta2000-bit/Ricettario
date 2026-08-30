import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractRecipeWithLlm, type MessagesClient } from "./llmExtract.ts";

function fakeClient(
  responseText: string,
  onCreate?: (params: Record<string, unknown>) => void,
): MessagesClient {
  return {
    messages: {
      create: async (params) => {
        onCreate?.(params);
        return { content: [{ type: "text", text: responseText }] };
      },
    },
  };
}

Deno.test("parses a well-formed structured response into a RecipeDraft", async () => {
  const draft = await extractRecipeWithLlm(
    "some transcript text",
    fakeClient(
      JSON.stringify({
        title: "Tomato Soup",
        complexity: "Easy",
        servings: "4",
        ingredients: [{ rawText: "2 cans tomatoes", quantity: 2, unit: "cans", name: "tomatoes" }],
        steps: [{ instruction: "Chop the onion.", estimatedMinutes: 5 }],
      }),
    ),
  );
  assertEquals(draft.title, "Tomato Soup");
  assertEquals(draft.ingredients[0].name, "tomatoes");
  assertEquals(draft.steps[0].estimatedMinutes, 5);
});

Deno.test("requests deterministic sampling, since this is extraction not creative writing", async () => {
  let params: Record<string, unknown> = {};
  await extractRecipeWithLlm(
    "some transcript text",
    fakeClient(
      JSON.stringify({ title: "Tomato Soup", complexity: null, servings: null, ingredients: [], steps: [] }),
      (p) => (params = p),
    ),
  );
  assertEquals(params.temperature, 0);
});

Deno.test("throws when the model returns no text block", async () => {
  const client: MessagesClient = { messages: { create: async () => ({ content: [] }) } };
  await assertRejects(() => extractRecipeWithLlm("text", client), Error, "No structured output returned");
});

Deno.test("throws a specific error when the response was truncated by max_tokens", async () => {
  const client: MessagesClient = {
    messages: {
      create: async () => ({ content: [{ type: "text", text: '{"title": "Truncated' }], stop_reason: "max_tokens" }),
    },
  };
  await assertRejects(() => extractRecipeWithLlm("text", client), Error, "response was truncated");
});
