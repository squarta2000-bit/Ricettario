import type { RecipeDraft } from "./types.ts";

// Merges a JSON-LD-derived draft with an independently LLM-derived draft of
// the same page. JSON-LD's structured ingredients/steps/title are cleaner
// and more reliable than an LLM re-deriving them from raw page text, so they
// win outright when present. Complexity only ever comes from the LLM, since
// schema.org Recipe has no difficulty field. prepMinutes/cookMinutes/
// servings/imageUrl prefer JSON-LD's value, falling back to the LLM's guess
// only when JSON-LD didn't state one.
export function mergeDrafts(jsonLdDraft: RecipeDraft | null, llmDraft: RecipeDraft): RecipeDraft {
  if (!jsonLdDraft) return llmDraft;

  return {
    title: jsonLdDraft.title,
    complexity: llmDraft.complexity,
    servings: jsonLdDraft.servings ?? llmDraft.servings,
    imageUrl: jsonLdDraft.imageUrl ?? llmDraft.imageUrl,
    prepMinutes: jsonLdDraft.prepMinutes ?? llmDraft.prepMinutes,
    cookMinutes: jsonLdDraft.cookMinutes ?? llmDraft.cookMinutes,
    ingredients: jsonLdDraft.ingredients,
    steps: jsonLdDraft.steps,
  };
}
