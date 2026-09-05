# Step Instruction Enrichment — Design Spec

Date: 2026-09-05
Status: Approved for planning

## 1. Objective

The recently-shipped `matchIngredientsToSteps.ts` appends a deterministic "Needs: ..." recap line under each step, listing ingredients whose name appears in that step's text. That's useful but leaves the step's own sentence unchanged, so generic references inside it ("le plat", "l'ail", "le beurre") stay vague even though the recap line right below spells out the detail.

This iteration goes further: rewrite the step's own instruction text in place so those generic references are expanded to include their quantity/descriptive detail from the ingredient list, while staying grammatically correct in the source's own language (e.g. "Frotter le plat avec de l'ail et la moitié du beurre" → "Frotter le plat de 20 cm sur 30 cm avec une gousse d'ail rose et la moitié de 50 g de beurre"). This requires real language generation — grammatical agreement, article contraction, quantity insertion — which a deterministic matcher cannot do reliably across the app's three languages (en/it/fr). It requires an LLM call.

## 2. Scope for this iteration

- One additional LLM pass, run once per import (not per page render), after ingredients/steps are finalized.
- The rewritten instruction is stored (`enrichedInstruction`), never computed live in the browser — unlike `matchIngredientsToSteps`, this is too slow/costly to redo on every page view.
- The existing "Needs:" recap line becomes the fallback for steps where enrichment didn't apply (returned `null`) or the enrichment pass itself failed.
- A one-off backfill script (not part of the deployed app) enriches recipes that already exist in the database, run by hand once against the hosted Supabase project.
- **Out of scope**: an in-app "regenerate/enhance" action for existing recipes (rejected in favor of the one-off backfill — see §9); re-running enrichment automatically when a recipe is edited (the review screen only edits raw instruction text, same as today).

## 3. Constraints & priorities

- **Never invent facts.** The rewrite must only use quantities/details already present in the ingredient list for that recipe — no guessing.
- **Preserve the original.** The raw `instruction` is always kept as-is in the DB; `enrichedInstruction` is purely additive. If enrichment is wrong, unavailable, or stale, the app must be able to fall back to exactly today's behavior (raw instruction + "Needs:" recap).
- **Enrichment failure must never fail an import.** It's an enhancement, not core functionality — a broken or malformed LLM response for this pass degrades gracefully, it does not surface an error to the user or block saving.
- **Cost.** One extra Haiku call per import, same cost profile as the existing extraction calls (already 1–2 per import). Acceptable per prior conventions in this codebase.
- **Staleness after manual edits.** The review screen (`ImportPage.tsx`) lets the user freely retype step text before saving. If a step's raw instruction is edited there, any enrichment computed for the *original* text must not be shown against the *edited* text — that would display a rewritten sentence that no longer matches, which is worse than showing nothing.

## 4. Architecture overview

```
Existing pipeline (unchanged up to mergeDrafts):

extraction (llmExtract / llmExtractImages / jsonld) → mergeDrafts → draft
                                                                      │
                                                                      ▼
                                                     enrichSteps(ingredients, steps, client)
                                                                      │
                                                    draft.steps[i].enrichedInstruction set
                                                                      │
                                                                      ▼
                                                        returned to ImportPage for review
                                                                      │
                                              user edits raw instruction text (unchanged flow)
                                                                      │
                                                                      ▼
                                                    saveRecipe / updateRecipe → steps table
                                                       (instruction + enriched_instruction)
                                                                      │
                                                                      ▼
                                      RecipeDetailPage / CookingModePage render enrichedInstruction
                                        when present, else instruction + "Needs:" recap


One-off backfill (not part of the app, run once by hand):

scripts/backfillEnrichedInstructions.ts (service role key)
  → reads every existing recipe's ingredients + steps
  → enrichSteps(...) per recipe
  → writes enriched_instruction directly
```

## 5. Data model changes

```sql
-- 0007_add_step_enriched_instruction.sql
alter table steps add column enriched_instruction text;
```

Nullable, no default. `null` means "no enrichment available for this step" — the only state existing rows can be in until backfilled, and the fallback state after any enrichment failure.

## 6. Extraction pipeline

New module `supabase/functions/server/extraction/enrichSteps.ts`:

```ts
export async function enrichSteps(
  ingredients: { rawText: string; quantity: number | null; unit: string | null; name: string }[],
  steps: { instruction: string }[],
  client: MessagesClient,
): Promise<(string | null)[]>
```

- One structured-output call (`claude-haiku-4-5`, `temperature: 0`, `output_config.format: json_schema` — same pattern as `llmExtract.ts`).
- Schema: `{ steps: { enrichedInstruction: string | null }[] }`, one entry per input step, in order.
- Prompt instructs: rewrite an instruction only if it refers to an ingredient or piece of equipment from the list *generically* (a bare noun/pronoun lacking its quantity or descriptive detail); expand that reference in place using only the ingredient list's own data; keep everything else in the sentence unchanged; keep the output in the same language as the input; return `null` for any step that doesn't need this.
- Called once from `routes/import.ts`, after `draft` is fully assembled (post-`mergeDrafts` for URL imports, post-extraction for text/photo/video imports) and before the response is returned — applies identically regardless of source.

`routes/import.ts` change:

```ts
try {
  const enriched = await enrichSteps(draft.ingredients, draft.steps, deps.llmClientFactory());
  draft = { ...draft, steps: draft.steps.map((s, i) => ({ ...s, enrichedInstruction: enriched[i] ?? null })) };
} catch {
  draft = { ...draft, steps: draft.steps.map((s) => ({ ...s, enrichedInstruction: null })) };
}
```

## 7. Types & threading

Add `enrichedInstruction: string | null` to the step shape everywhere it's threaded:

- `server/extraction/types.ts` — `RecipeDraft.steps[]` item.
- `src/app/lib/types.ts` — `Step`, `RecipeDraftStep`, and `SaveRecipeInput.steps[]` item.
- `llmExtract.ts` / `llmExtractImages.ts` / `jsonld.ts` — each sets `enrichedInstruction: null` when constructing a fresh draft (enrichment is applied later, once, in `import.ts`); `mergeDrafts.ts` needs no change since it runs before enrichment.
- `recipesApi.ts` — `getRecipe` reads `enriched_instruction`; `buildIngredientAndStepRows` writes it for both `saveRecipe` and `updateRecipe`.

## 8. Review screen (`ImportPage.tsx`)

The steps `Textarea`'s `onChange` rebuilds the whole `draft.steps` array from the raw text, matching by line index against the previous `d.steps[index]` (already done today for `estimatedMinutes`). For `enrichedInstruction`, add a guard: only carry it over if the line's text is unchanged from the previous draft at that index —

```ts
steps: e.target.value.split('\n').map((line, index) => {
  const previous = d.steps[index]
  return {
    instruction: line,
    estimatedMinutes: previous?.estimatedMinutes ?? null,
    enrichedInstruction: previous?.instruction === line ? previous.enrichedInstruction ?? null : null,
  }
}),
```

This is intentionally stricter than the existing `estimatedMinutes` carry-over (which is left as-is, out of scope here): showing a rewritten sentence that no longer matches the edited raw text is a materially worse failure mode than a stale duration number, so it gets its own correctness guard rather than reusing the looser existing pattern.

The edit-load `useEffect` (loading an existing recipe into the review form) also maps `enrichedInstruction` through unchanged, same as `estimatedMinutes` today.

## 9. Rendering (`RecipeDetailPage.tsx`, `CookingModePage.tsx`)

For each step: if `enrichedInstruction` is non-null, render it in place of `instruction`, and do not render the "Needs:" recap line for that step (redundant — the detail is now inline). If `enrichedInstruction` is `null` (not yet enriched, nothing to rewrite, or enrichment failed), render `instruction` as today, followed by the existing "Needs:" recap from `matchIngredientsForStep` when it has matches.

## 10. Error handling

- **Enrichment LLM call fails or returns malformed output** (thrown error, schema mismatch, truncated response): caught in `import.ts`; every step in that import gets `enrichedInstruction: null`. Per §9, this is indistinguishable from "nothing needed rewriting" at render time — the user sees exactly today's actual behavior (plain instruction + "Needs:" recap), never an error message or a blank step. No retry, no partial application.
- **Backfill script failure for one recipe**: logged and skipped; the script continues to the next recipe rather than aborting the run.

## 11. Testing strategy

- `enrichSteps.test.ts` (new, same style as `llmExtract.test.ts` — a fake `MessagesClient`): a step that gets rewritten; a step returned as `null`; a truncated/malformed response surfaces as a thrown error (caller's `catch` is exercised at the `import.ts` level, not here).
- No new frontend unit tests for the `ImportPage.tsx` carry-over guard — there are no existing page-level component tests in this repo (confirmed against the current test suite), so it's verified by browser check alongside the rest of the review screen, consistent with how the rest of that page is tested today.
- Manual browser verification against the already-imported Gratin Dauphinois recipe (post-backfill) and against a fresh import, covering: an enriched step hides its "Needs:" line, a non-enriched step still shows it, and editing a step's text in the review screen drops its stale enrichment.

## 12. Backfill script

`scripts/backfillEnrichedInstructions.ts` — a one-off Deno script, not deployed, not wired into any route:

- Uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `ANTHROPIC_API_KEY` from the environment.
- Fetches every recipe's `ingredients` and `steps` (ordered by `position`).
- Calls `enrichSteps` once per recipe (reusing the same module `import.ts` uses).
- Writes `enriched_instruction` back per step.
- Logs and continues past any single recipe's failure (§10).
- Run once by hand after the migration lands; not re-run automatically, and not exposed anywhere in the app.

## 13. Explicitly deferred (not this iteration)

- An in-app "enhance/regenerate" action for existing recipes (rejected in favor of the one-off backfill).
- Re-enriching automatically when a recipe is edited/saved.
- Enriching ingredient *names* or the ingredients list itself — this iteration only rewrites step instructions.
