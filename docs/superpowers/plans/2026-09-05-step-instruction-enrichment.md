# Step Instruction Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite each step's instruction text in place so generic ingredient/equipment references (e.g. "le plat", "l'ail", "le beurre") expand to their full quantity/detail from the ingredient list, staying grammatically correct — computed once per import via an LLM pass, stored, and rendered in place of the plain "Needs:" recap when present.

**Architecture:** A new `enrichSteps()` module makes one structured-output LLM call per import (after `mergeDrafts`), returning one rewritten instruction (or `null`) per step. `routes/import.ts` calls it and merges the result into the draft, catching any failure and falling back to `null` for every step (indistinguishable at render time from "nothing needed rewriting" — i.e. today's actual behavior). The result threads through `types.ts` → `recipesApi.ts` → a new nullable `steps.enriched_instruction` DB column → `RecipeDetailPage.tsx` / `CookingModePage.tsx`, which render it in place of the raw instruction and hide the "Needs:" recap when it's present. A one-off script backfills existing recipes.

**Tech Stack:** Deno (Supabase Edge Functions, `deno test`), React/TypeScript frontend (Vite, `vitest`), Supabase Postgres (SQL migrations), Anthropic Claude Haiku via `@anthropic-ai/sdk`.

**Spec:** `docs/superpowers/specs/2026-09-05-step-ingredient-enrichment-design.md`

## Global Constraints

- Never invent a quantity/detail not present in the ingredient list (spec §3).
- The raw `instruction` is always preserved; `enrichedInstruction` is purely additive, never a replacement in storage (spec §3).
- Enrichment failure must never fail an import — malformed/errored output falls back to `enrichedInstruction: null` for every step of that import, which renders identically to today's plain instruction + "Needs:" recap (spec §3, §10 — confirmed with the user this is the correct fallback, not a separate error state).
- One extra Haiku call per import, `temperature: 0`, structured `json_schema` output — same pattern as `llmExtract.ts` (spec §6).
- This plan does **not** apply migration 0007 to the hosted Supabase project or deploy the edge function — the user does this by hand (confirmed with the user; no Supabase CLI is installed in this environment, and PostgREST/service-role access cannot run DDL).
- This plan does **not** produce Playwright screenshots for this feature — confirmed with the user (no way to seed `enriched_instruction` or log in without either the DB migration already applied or a service-role key, both declined for this session). Verification is via `deno test`, `vitest run`, and the production build.

---

### Task 1: `enrichSteps` extraction module

**Files:**
- Create: `supabase/functions/server/extraction/enrichSteps.ts`
- Test: `supabase/functions/server/extraction/enrichSteps.test.ts`

**Interfaces:**
- Consumes: `MessagesClient` from `./llmExtract.ts` (already exists: `{ messages: { create(params): Promise<LlmResponse> } }`); `LlmResponse` from `./llmShared.ts` (already exists: `{ content: Array<{ type: string; text?: string }>; stop_reason?: string }`).
- Produces: `enrichSteps(ingredients: { rawText: string; quantity: number | null; unit: string | null; name: string }[], steps: { instruction: string }[], client: MessagesClient): Promise<(string | null)[]>` — one entry per input step, in order. Task 2 imports this exact signature.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/server/extraction/enrichSteps.test.ts
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
        create: async (p) => {
          params = p;
          return { content: [{ type: "text", text: JSON.stringify({ steps: [{ enrichedInstruction: null }] }) }] };
        },
      },
    },
  );
  assertEquals(params.temperature, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test supabase/functions/server/extraction/enrichSteps.test.ts`
Expected: fails to even type-check/load — `enrichSteps.ts` does not exist yet (`Module not found`).

- [ ] **Step 3: Write the implementation**

```ts
// supabase/functions/server/extraction/enrichSteps.ts
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

  return parsed.steps.map((s) => s.enrichedInstruction ?? null);
}

export async function enrichSteps(
  ingredients: EnrichmentIngredient[],
  steps: EnrichmentStep[],
  client: MessagesClient,
): Promise<(string | null)[]> {
  if (steps.length === 0) return [];

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4000,
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test supabase/functions/server/extraction/enrichSteps.test.ts`
Expected: `7 passed | 0 failed`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/server/extraction/enrichSteps.ts supabase/functions/server/extraction/enrichSteps.test.ts
git commit -m "feat: add LLM step-instruction enrichment module"
```

---

### Task 2: Wire enrichment into the import route, and add the DB migration

**Files:**
- Modify: `supabase/functions/server/extraction/types.ts`
- Modify: `supabase/functions/server/routes/import.ts`
- Modify: `supabase/functions/server/routes/import.test.ts`
- Create: `supabase/migrations/0007_add_step_enriched_instruction.sql`

**Interfaces:**
- Consumes: `enrichSteps` from Task 1 (`./extraction/enrichSteps.ts`).
- Produces: `RecipeDraft.steps[]` items now carry an optional `enrichedInstruction?: string | null`, populated by `import.ts` before the response is returned. Task 3 (frontend types) mirrors this shape.

- [ ] **Step 1: Add the optional field to the server-side draft type**

In `supabase/functions/server/extraction/types.ts`, change:

```ts
  steps: { instruction: string; estimatedMinutes: number | null }[]
```

to:

```ts
  steps: { instruction: string; estimatedMinutes: number | null; enrichedInstruction?: string | null }[]
```

(Optional, not required — `llmExtract.ts`, `llmExtractImages.ts`, and `jsonld.ts` keep constructing steps without this field; it's only ever set below, after `mergeDrafts`, so none of those extractors or their existing tests need to change.)

- [ ] **Step 2: Write the failing tests**

Add to `supabase/functions/server/routes/import.test.ts` (append at the end of the file):

```ts
Deno.test("threads the enrichment pass's rewritten instructions into the response", async () => {
  let callCount = 0;
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => ({
      messages: {
        create: async () => {
          callCount += 1;
          if (callCount === 1) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    title: "Soup",
                    complexity: null,
                    servings: null,
                    ingredients: [{ rawText: "1 onion", quantity: 1, unit: null, name: "onion" }],
                    steps: [{ instruction: "Chop the onion.", estimatedMinutes: 5 }],
                  }),
                },
              ],
            };
          }
          return {
            content: [
              { type: "text", text: JSON.stringify({ steps: [{ enrichedInstruction: "Chop the 1 onion." }] }) },
            ],
          };
        },
      },
    }),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "text", text: "Chop the onion." }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.draft.steps[0].enrichedInstruction, "Chop the 1 onion.");
});

Deno.test("falls back to null enrichedInstruction for every step when the enrichment call fails", async () => {
  let callCount = 0;
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => ({
      messages: {
        create: async () => {
          callCount += 1;
          if (callCount === 1) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    title: "Soup",
                    complexity: null,
                    servings: null,
                    ingredients: [],
                    steps: [
                      { instruction: "Chop the onion.", estimatedMinutes: 5 },
                      { instruction: "Simmer.", estimatedMinutes: 10 },
                    ],
                  }),
                },
              ],
            };
          }
          throw new Error("enrichment call failed");
        },
      },
    }),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "text", text: "Chop the onion. Simmer." }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.draft.steps[0].enrichedInstruction, null);
  assertEquals(body.draft.steps[1].enrichedInstruction, null);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `deno test supabase/functions/server/routes/import.test.ts`
Expected: the two new tests FAIL — `body.draft.steps[0].enrichedInstruction` is `undefined`, not `"Chop the 1 onion."` / `null`. All other existing tests in this file still pass unchanged (they never assert on `enrichedInstruction`, and every fixture with an empty final `steps` array skips the new call entirely per Task 1's short-circuit).

- [ ] **Step 4: Write the implementation**

In `supabase/functions/server/routes/import.ts`, add the import:

```ts
import { enrichSteps } from "../extraction/enrichSteps.ts";
```

Then, immediately before `return c.json({ draft, sourceType });` (currently the last line inside the `try` block), insert:

```ts
      if (draft) {
        try {
          const enriched = await enrichSteps(draft.ingredients, draft.steps, deps.llmClientFactory());
          draft = { ...draft, steps: draft.steps.map((s, i) => ({ ...s, enrichedInstruction: enriched[i] ?? null })) };
        } catch {
          // Enrichment is an enhancement, not core functionality - never let a
          // failure here block the import itself. Falling back to null for
          // every step renders identically to today's actual behavior (plain
          // instruction + "Needs:" recap), never an error state.
          draft = { ...draft, steps: draft.steps.map((s) => ({ ...s, enrichedInstruction: null })) };
        }
      }

      return c.json({ draft, sourceType });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test supabase/functions/server/routes/import.test.ts`
Expected: `27 passed | 0 failed` (25 existing + 2 new).

- [ ] **Step 6: Create the DB migration**

```sql
-- supabase/migrations/0007_add_step_enriched_instruction.sql
-- Nullable, additive: null means "no enrichment available for this step" -
-- the state every existing row is in until backfilled, and the fallback
-- state after any enrichment failure (see enrichSteps.ts).
alter table steps add column enriched_instruction text;
```

This migration is **not applied** to the hosted project by this task — per the Global Constraints, the user applies it by hand (`supabase db push`, or pasting the SQL into the Supabase dashboard's SQL editor).

- [ ] **Step 7: Run the full server test suite to confirm nothing else broke**

Run: `deno test supabase/functions/server`
Expected: all tests pass, including the pre-existing `llmExtract.test.ts`, `mergeDrafts.test.ts`, `jsonld.test.ts`, etc.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/server/extraction/types.ts supabase/functions/server/routes/import.ts supabase/functions/server/routes/import.test.ts supabase/migrations/0007_add_step_enriched_instruction.sql
git commit -m "feat: enrich step instructions during import, add enriched_instruction column"
```

---

### Task 3: Thread `enrichedInstruction` through frontend types and `recipesApi.ts`

**Files:**
- Modify: `src/app/lib/types.ts`
- Modify: `src/app/lib/recipesApi.ts`

**Interfaces:**
- Consumes: nothing new from other tasks (this task only changes shapes/mappings).
- Produces: `Step.enrichedInstruction: string | null` (always present, read from the DB); `RecipeDraftStep.enrichedInstruction?: string | null` (optional, mirrors the server draft shape from Task 2); `SaveRecipeInput.steps[]` items carry `enrichedInstruction?: string | null`. Tasks 4 and 5 rely on these exact property names.

There is no existing unit-test coverage for `getRecipe`/`saveRecipe`/`updateRecipe` in this repo (`recipesApi.test.ts` only covers the pure `sumStepMinutes` helper — these three functions call the real Supabase client directly and are otherwise only exercised by the e2e suite). This task follows that existing convention rather than introducing new mocking for it; there is no failing-test step here.

- [ ] **Step 1: Update `src/app/lib/types.ts`**

Change:

```ts
export interface Step {
  id: string
  recipeId: string
  position: number
  instruction: string
  estimatedMinutes: number | null
}
```

to:

```ts
export interface Step {
  id: string
  recipeId: string
  position: number
  instruction: string
  estimatedMinutes: number | null
  enrichedInstruction: string | null
}
```

Change:

```ts
export interface RecipeDraftStep {
  instruction: string
  estimatedMinutes: number | null
}
```

to:

```ts
export interface RecipeDraftStep {
  instruction: string
  estimatedMinutes: number | null
  enrichedInstruction?: string | null
}
```

- [ ] **Step 2: Update `src/app/lib/recipesApi.ts`**

In `getRecipe`'s `steps` mapping, change:

```ts
    steps: [...data.steps]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        recipeId: s.recipe_id,
        position: s.position,
        instruction: s.instruction,
        estimatedMinutes: s.estimated_minutes,
      })),
```

to:

```ts
    steps: [...data.steps]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        recipeId: s.recipe_id,
        position: s.position,
        instruction: s.instruction,
        estimatedMinutes: s.estimated_minutes,
        enrichedInstruction: s.enriched_instruction,
      })),
```

In `SaveRecipeInput`, change:

```ts
  steps: { instruction: string; estimatedMinutes: number | null }[]
```

to:

```ts
  steps: { instruction: string; estimatedMinutes: number | null; enrichedInstruction?: string | null }[]
```

In `buildIngredientAndStepRows`, change:

```ts
  const stepRows = input.steps.map((step, index) => ({
    recipe_id: recipeId,
    position: index,
    instruction: step.instruction,
    estimated_minutes: step.estimatedMinutes,
  }))
```

to:

```ts
  const stepRows = input.steps.map((step, index) => ({
    recipe_id: recipeId,
    position: index,
    instruction: step.instruction,
    estimated_minutes: step.estimatedMinutes,
    enriched_instruction: step.enrichedInstruction ?? null,
  }))
```

- [ ] **Step 3: Run the frontend test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: all existing tests still pass (`recipesApi.test.ts` only tests `sumStepMinutes`, unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/app/lib/types.ts src/app/lib/recipesApi.ts
git commit -m "feat: thread enrichedInstruction through recipe types and the Supabase API layer"
```

---

### Task 4: Carry `enrichedInstruction` through the review screen safely

**Files:**
- Modify: `src/app/pages/ImportPage.tsx`

**Interfaces:**
- Consumes: `RecipeDraftStep.enrichedInstruction` and `Step.enrichedInstruction` from Task 3.
- Produces: no new exports — this task only changes internal state handling in `ImportPage`.

There are no existing page-level component tests in this repo for `ImportPage.tsx` (confirmed against the current test suite — coverage for this page is via e2e only). This task follows that convention; verification is a manual reasoning check plus the existing e2e suite continuing to pass (Task 6).

- [ ] **Step 1: Carry the field through when loading an existing recipe for editing**

In the `editId` load effect, change:

```ts
          steps: recipe.steps.map((s) => ({ instruction: s.instruction, estimatedMinutes: s.estimatedMinutes })),
```

to:

```ts
          steps: recipe.steps.map((s) => ({
            instruction: s.instruction,
            estimatedMinutes: s.estimatedMinutes,
            enrichedInstruction: s.enrichedInstruction,
          })),
```

- [ ] **Step 2: Guard the steps textarea's carry-over against stale enrichment**

Change the steps `Textarea`'s `onChange`:

```tsx
          onChange={(e) =>
            setDraft(
              (d) =>
                d && {
                  ...d,
                  steps: e.target.value
                    .split('\n')
                    .map((line, index) => ({
                      instruction: line,
                      estimatedMinutes: d.steps[index]?.estimatedMinutes ?? null,
                    })),
                },
            )
          }
```

to:

```tsx
          onChange={(e) =>
            setDraft(
              (d) =>
                d && {
                  ...d,
                  steps: e.target.value.split('\n').map((line, index) => {
                    const previous = d.steps[index]
                    return {
                      instruction: line,
                      estimatedMinutes: previous?.estimatedMinutes ?? null,
                      // A rewritten instruction that no longer matches the raw
                      // text it was computed from would actively mislead the
                      // user - drop it as soon as this line's text changes.
                      enrichedInstruction: previous?.instruction === line ? previous.enrichedInstruction ?? null : null,
                    }
                  }),
                },
            )
          }
```

- [ ] **Step 3: Run the frontend build to confirm no syntax errors**

Run: `node ./node_modules/vite/bin/vite.js build`
Expected: builds successfully (this repo has no `tsc` typecheck step configured — confirmed no `tsconfig.json` exists — so `vite build` is the correctness gate for this file).

- [ ] **Step 4: Commit**

```bash
git add src/app/pages/ImportPage.tsx
git commit -m "fix: drop stale enriched instructions when a review-screen step is edited"
```

---

### Task 5: Render `enrichedInstruction` in place of the plain instruction

**Files:**
- Modify: `src/app/pages/RecipeDetailPage.tsx`
- Modify: `src/app/pages/CookingModePage.tsx`

**Interfaces:**
- Consumes: `Step.enrichedInstruction` from Task 3; `matchIngredientsForStep` (already exists, unchanged, from `src/app/lib/matchIngredientsToSteps.ts`); `formatIngredientLine` (already exists, unchanged, from `src/app/lib/europeanFormat.ts`).
- Produces: no new exports.

No new automated tests here either (same reasoning as Task 4 — these pages have no component-level test coverage in this repo). Verified by the build (Step 3 below) plus a manual reasoning walkthrough, consistent with the spec's testing strategy §11.

- [ ] **Step 1: Update `RecipeDetailPage.tsx`'s steps list**

Change:

```tsx
          {recipe.steps.map((step) => {
            const neededIngredients = matchIngredientsForStep(step, recipe.ingredients)
            return (
              <li key={step.id} className="text-sm">
                {step.instruction}
                {step.estimatedMinutes != null && (
                  <span className="text-muted-foreground"> ({formatNumber(step.estimatedMinutes)} min)</span>
                )}
                {neededIngredients.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('recipeDetail.needs')}: {neededIngredients.map(formatIngredientLine).join(', ')}
                  </p>
                )}
              </li>
            )
          })}
```

to:

```tsx
          {recipe.steps.map((step) => {
            const neededIngredients = matchIngredientsForStep(step, recipe.ingredients)
            return (
              <li key={step.id} className="text-sm">
                {step.enrichedInstruction ?? step.instruction}
                {step.estimatedMinutes != null && (
                  <span className="text-muted-foreground"> ({formatNumber(step.estimatedMinutes)} min)</span>
                )}
                {step.enrichedInstruction == null && neededIngredients.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('recipeDetail.needs')}: {neededIngredients.map(formatIngredientLine).join(', ')}
                  </p>
                )}
              </li>
            )
          })}
```

- [ ] **Step 2: Update `CookingModePage.tsx`'s current-step display**

Change:

```tsx
              <p className="text-xl mb-4">{step.instruction}</p>
              {neededIngredients.length > 0 && (
                <p className="text-sm text-muted-foreground mb-4">
                  {t('recipeDetail.needs')}: {neededIngredients.map(formatIngredientLine).join(', ')}
                </p>
              )}
```

to:

```tsx
              <p className="text-xl mb-4">{step.enrichedInstruction ?? step.instruction}</p>
              {step.enrichedInstruction == null && neededIngredients.length > 0 && (
                <p className="text-sm text-muted-foreground mb-4">
                  {t('recipeDetail.needs')}: {neededIngredients.map(formatIngredientLine).join(', ')}
                </p>
              )}
```

- [ ] **Step 3: Run the frontend build and test suite**

Run: `npx vitest run && node ./node_modules/vite/bin/vite.js build`
Expected: all tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/pages/RecipeDetailPage.tsx src/app/pages/CookingModePage.tsx
git commit -m "feat: render enriched step instructions, hiding the Needs recap when present"
```

---

### Task 6: One-off backfill script for existing recipes

**Files:**
- Create: `scripts/backfillEnrichedInstructions.ts`

**Interfaces:**
- Consumes: `enrichSteps` from Task 1 (`supabase/functions/server/extraction/enrichSteps.ts`); `createAnthropicMessagesClient` from `supabase/functions/server/extraction/llmExtract.ts` (already exists).
- Produces: nothing consumed by later tasks — this is a standalone, one-off operational script, not wired into the app or any route (per spec §12, §13).

This is glue/orchestration code (env var reads, DB I/O, a loop) in the same category as the existing, also-untested `e2e/helpers/auth.ts` admin-client helper — no unit test is added for it, consistent with that precedent. It is not run as part of this plan (per Global Constraints, migration 0007 isn't applied to the hosted DB yet, so the column this script writes doesn't exist there); the user runs it by hand after applying the migration.

- [ ] **Step 1: Write the script**

```ts
// scripts/backfillEnrichedInstructions.ts
//
// One-off script: enriches every existing recipe's step instructions that
// don't have one yet. Not part of the deployed app - run once by hand,
// after migration 0007 has been applied to the hosted project:
//
//   deno run --allow-net --allow-env scripts/backfillEnrichedInstructions.ts
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ANTHROPIC_API_KEY
// in the environment.
import { createClient } from "npm:@supabase/supabase-js@2";
import { enrichSteps } from "../supabase/functions/server/extraction/enrichSteps.ts";
import { createAnthropicMessagesClient } from "../supabase/functions/server/extraction/llmExtract.ts";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicApiKey = requireEnv("ANTHROPIC_API_KEY");

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const client = createAnthropicMessagesClient(anthropicApiKey);

  const { data: recipes, error: recipesError } = await admin.from("recipes").select("id, title");
  if (recipesError) throw new Error(`Failed to list recipes: ${recipesError.message}`);

  for (const recipe of recipes ?? []) {
    try {
      const [{ data: ingredients, error: ingredientsError }, { data: steps, error: stepsError }] = await Promise.all([
        admin.from("ingredients").select("raw_text, quantity, unit, name").eq("recipe_id", recipe.id),
        admin.from("steps").select("id, instruction, enriched_instruction").eq("recipe_id", recipe.id).order("position"),
      ]);
      if (ingredientsError) throw new Error(`Failed to load ingredients: ${ingredientsError.message}`);
      if (stepsError) throw new Error(`Failed to load steps: ${stepsError.message}`);

      const pendingSteps = (steps ?? []).filter((s) => s.enriched_instruction == null);
      if (pendingSteps.length === 0) {
        console.log(`Skipping "${recipe.title}" (${recipe.id}): already enriched or has no steps`);
        continue;
      }

      const enriched = await enrichSteps(
        (ingredients ?? []).map((i) => ({ rawText: i.raw_text, quantity: i.quantity, unit: i.unit, name: i.name })),
        pendingSteps.map((s) => ({ instruction: s.instruction })),
        client,
      );

      for (let i = 0; i < pendingSteps.length; i++) {
        const { error: updateError } = await admin
          .from("steps")
          .update({ enriched_instruction: enriched[i] })
          .eq("id", pendingSteps[i].id);
        if (updateError) throw new Error(`Failed to write enriched_instruction: ${updateError.message}`);
      }

      console.log(`Enriched "${recipe.title}" (${recipe.id}): ${pendingSteps.length} step(s)`);
    } catch (error) {
      console.error(`Skipping "${recipe.title}" (${recipe.id}) after failure:`, error);
    }
  }
}

await main();
```

- [ ] **Step 2: Commit**

```bash
git add scripts/backfillEnrichedInstructions.ts
git commit -m "chore: add one-off backfill script for existing recipes' enriched instructions"
```

---

### Task 7: Full verification pass

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full server test suite**

Run: `deno test supabase/functions/server`
Expected: all tests pass (including Tasks 1 and 2's new tests).

- [ ] **Step 2: Run the full frontend test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Run the production build**

Run: `node ./node_modules/vite/bin/vite.js build`
Expected: builds successfully.

- [ ] **Step 4: Report remaining manual steps to the user**

No code changes in this step — summarize for the user, in the chat response (not a file), that:
1. Migration `0007_add_step_enriched_instruction.sql` still needs to be applied to the hosted project by them (`supabase db push`, or via the Supabase dashboard's SQL editor).
2. The updated edge function (`supabase/functions/server`) still needs to be deployed by them (`supabase functions deploy server`) before new imports actually produce enriched instructions.
3. `scripts/backfillEnrichedInstructions.ts` should be run by them, once, after both of the above, to enrich existing recipes (including the Gratin Dauphinois one used earlier in this conversation).
4. No Playwright screenshots were produced for this feature, per the earlier decision — visual verification happens once the user has applied the migration/deploy and can check it live themselves.
