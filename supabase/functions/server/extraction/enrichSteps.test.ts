import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { enrichSteps } from "./enrichSteps.ts";
import type { MessagesClient } from "./llmExtract.ts";

function fakeClient(responseText: string, stopReason?: string): MessagesClient {
  return {
    messages: {
      create: async () => ({ content: [{ type: "text", text: responseText }], stop_reason: stopReason }),
    },
  };
}

const ONE_INGREDIENT = [{ rawText: "50 g beurre", quantity: 50, unit: "g", name: "beurre" }];
const ONE_STEP = [{ instruction: "Ajouter la moitié du beurre." }];

Deno.test("returns an empty array without calling the LLM when there are no steps", async () => {
  let called = false;
  const client: MessagesClient = { messages: { create: async () => { called = true; return { content: [] }; } } };
  const result = await enrichSteps(ONE_INGREDIENT, [], client);
  assertEquals(result, []);
  assertEquals(called, false);
});

Deno.test("returns the rewritten instruction for a step the model chose to rewrite", async () => {
  const result = await enrichSteps(
    ONE_INGREDIENT,
    ONE_STEP,
    fakeClient(JSON.stringify({ steps: [{ enrichedInstruction: "Ajouter la moitié de 50 g de beurre." }] })),
  );
  assertEquals(result, ["Ajouter la moitié de 50 g de beurre."]);
});

Deno.test("returns null for a step the model says needs no rewrite", async () => {
  const result = await enrichSteps(
    ONE_INGREDIENT,
    ONE_STEP,
    fakeClient(JSON.stringify({ steps: [{ enrichedInstruction: null }] })),
  );
  assertEquals(result, [null]);
});

Deno.test("throws when the model returns no text block", async () => {
  const client: MessagesClient = { messages: { create: async () => ({ content: [] }) } };
  await assertRejects(() => enrichSteps(ONE_INGREDIENT, ONE_STEP, client), Error, "No structured output returned");
});

Deno.test("throws when the response was truncated by max_tokens", async () => {
  await assertRejects(
    () => enrichSteps(ONE_INGREDIENT, ONE_STEP, fakeClient('{"steps": [{"enrichedInstruction": null', "max_tokens")),
    Error,
    "truncated",
  );
});

Deno.test("throws when the number of returned entries does not match the number of input steps", async () => {
  await assertRejects(
    () => enrichSteps(ONE_INGREDIENT, ONE_STEP, fakeClient(JSON.stringify({ steps: [] }))),
    Error,
    "expected 1",
  );
});

Deno.test("requests deterministic sampling, since this is a rewrite pass not creative writing", async () => {
  let params: Record<string, unknown> = {};
  await enrichSteps(
    ONE_INGREDIENT,
    ONE_STEP,
    {
      messages: {
        create: async (p: Record<string, unknown>) => {
          params = p;
          return { content: [{ type: "text", text: JSON.stringify({ steps: [{ enrichedInstruction: null }] }) }] };
        },
      },
    },
  );
  assertEquals(params.temperature, 0);
});
