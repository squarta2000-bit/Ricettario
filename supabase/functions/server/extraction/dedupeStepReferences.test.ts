import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dedupeStepReferences } from "./dedupeStepReferences.ts";
import type { MessagesClient } from "./llmExtract.ts";

function fakeClient(responseText: string, stopReason?: string): MessagesClient {
  return {
    messages: {
      create: async () => ({ content: [{ type: "text", text: responseText }], stop_reason: stopReason }),
    },
  };
}

const ONE_INGREDIENT = [{ rawText: "1,3 kg pommes de terre Mona Lisa", quantity: 1.3, unit: "kg", name: "pommes de terre" }];
const TWO_INSTRUCTIONS = [
  "Peler et trancher finement les 1,3 kg de pommes de terre Mona Lisa.",
  "Ranger harmonieusement les 1,3 kg de pommes de terre Mona Lisa précuites dans le plat.",
];

Deno.test("returns an empty array without calling the LLM when there are no instructions", async () => {
  let called = false;
  const client: MessagesClient = { messages: { create: async () => { called = true; return { content: [] }; } } };
  const result = await dedupeStepReferences(ONE_INGREDIENT, [], client);
  assertEquals(result, []);
  assertEquals(called, false);
});

Deno.test("returns the shortened instructions the model chose to produce", async () => {
  const result = await dedupeStepReferences(
    ONE_INGREDIENT,
    TWO_INSTRUCTIONS,
    fakeClient(
      JSON.stringify({
        steps: [
          { instruction: "Peler et trancher finement les 1,3 kg de pommes de terre Mona Lisa." },
          { instruction: "Ranger harmonieusement les pommes de terre précuites dans le plat." },
        ],
      }),
    ),
  );
  assertEquals(result, [
    "Peler et trancher finement les 1,3 kg de pommes de terre Mona Lisa.",
    "Ranger harmonieusement les pommes de terre précuites dans le plat.",
  ]);
});

Deno.test("returns instructions unchanged when the model decides nothing needs shortening", async () => {
  const result = await dedupeStepReferences(
    ONE_INGREDIENT,
    TWO_INSTRUCTIONS,
    fakeClient(JSON.stringify({ steps: TWO_INSTRUCTIONS.map((instruction) => ({ instruction })) })),
  );
  assertEquals(result, TWO_INSTRUCTIONS);
});

Deno.test("throws when the model returns no text block", async () => {
  const client: MessagesClient = { messages: { create: async () => ({ content: [] }) } };
  await assertRejects(
    () => dedupeStepReferences(ONE_INGREDIENT, TWO_INSTRUCTIONS, client),
    Error,
    "No structured output returned",
  );
});

Deno.test("throws when the response was truncated by max_tokens", async () => {
  await assertRejects(
    () =>
      dedupeStepReferences(
        ONE_INGREDIENT,
        TWO_INSTRUCTIONS,
        fakeClient('{"steps": [{"instruction": "Peler', "max_tokens"),
      ),
    Error,
    "truncated",
  );
});

Deno.test("throws when the number of returned entries does not match the number of input instructions", async () => {
  await assertRejects(
    () => dedupeStepReferences(ONE_INGREDIENT, TWO_INSTRUCTIONS, fakeClient(JSON.stringify({ steps: [] }))),
    Error,
    "expected 2",
  );
});

Deno.test("includes each ingredient's rawText in the prompt", async () => {
  let params: Record<string, unknown> = {};
  await dedupeStepReferences(
    [{ rawText: "1 gousse ail rose", quantity: 1, unit: "gousse", name: "ail" }],
    ["Frotter le plat avec une gousse d'ail."],
    {
      messages: {
        create: async (p: Record<string, unknown>) => {
          params = p;
          return {
            content: [{ type: "text", text: JSON.stringify({ steps: [{ instruction: "Frotter le plat avec une gousse d'ail." }] }) }],
          };
        },
      },
    },
  );
  const promptText = JSON.stringify(params.messages);
  if (!promptText.includes("1 gousse ail rose")) {
    throw new Error(`Expected the prompt to include the ingredient's rawText, got: ${promptText}`);
  }
});

Deno.test("requests deterministic sampling, since this is a rewrite pass not creative writing", async () => {
  let params: Record<string, unknown> = {};
  await dedupeStepReferences(
    ONE_INGREDIENT,
    TWO_INSTRUCTIONS,
    {
      messages: {
        create: async (p: Record<string, unknown>) => {
          params = p;
          return {
            content: [{ type: "text", text: JSON.stringify({ steps: TWO_INSTRUCTIONS.map((instruction) => ({ instruction })) }) }],
          };
        },
      },
    },
  );
  assertEquals(params.temperature, 0);
});
