import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mergeDrafts } from "./mergeDrafts.ts";
import type { RecipeDraft } from "./types.ts";

function draft(overrides: Partial<RecipeDraft> = {}): RecipeDraft {
  return {
    title: "Title",
    complexity: null,
    servings: null,
    imageUrl: null,
    prepMinutes: null,
    cookMinutes: null,
    ingredients: [{ rawText: "1 egg", quantity: 1, unit: null, name: "egg" }],
    steps: [{ instruction: "Do it.", estimatedMinutes: 5 }],
    ...overrides,
  };
}

Deno.test("returns the LLM draft unchanged when there is no JSON-LD draft", () => {
  const llmDraft = draft({ title: "LLM Soup" });
  assertEquals(mergeDrafts(null, llmDraft), llmDraft);
});

Deno.test("prefers the JSON-LD title, ingredients, and steps over the LLM's", () => {
  const jsonLdDraft = draft({
    title: "JSON-LD Soup",
    ingredients: [{ rawText: "2 cans tomatoes", quantity: 2, unit: "cans", name: "tomatoes" }],
    steps: [{ instruction: "Simmer.", estimatedMinutes: 20 }],
  });
  const llmDraft = draft({
    title: "LLM Soup",
    ingredients: [{ rawText: "1 onion", quantity: 1, unit: null, name: "onion" }],
    steps: [{ instruction: "Chop.", estimatedMinutes: 5 }],
  });
  const merged = mergeDrafts(jsonLdDraft, llmDraft);
  assertEquals(merged.title, "JSON-LD Soup");
  assertEquals(merged.ingredients, jsonLdDraft.ingredients);
  assertEquals(merged.steps, jsonLdDraft.steps);
});

Deno.test("takes complexity only from the LLM draft, since JSON-LD never has one", () => {
  const jsonLdDraft = draft({ complexity: null });
  const llmDraft = draft({ complexity: "Facile" });
  const merged = mergeDrafts(jsonLdDraft, llmDraft);
  assertEquals(merged.complexity, "Facile");
});

Deno.test("prefers JSON-LD's prepMinutes/cookMinutes, falling back to the LLM's when JSON-LD lacks them", () => {
  const jsonLdDraft = draft({ prepMinutes: 40, cookMinutes: null });
  const llmDraft = draft({ prepMinutes: 999, cookMinutes: 120 });
  const merged = mergeDrafts(jsonLdDraft, llmDraft);
  assertEquals(merged.prepMinutes, 40); // JSON-LD's value wins
  assertEquals(merged.cookMinutes, 120); // falls back to the LLM's, since JSON-LD had none
});

Deno.test("prefers JSON-LD's servings/imageUrl, falling back to the LLM's when JSON-LD lacks them", () => {
  const jsonLdDraft = draft({ servings: null, imageUrl: null });
  const llmDraft = draft({ servings: "4", imageUrl: "https://example.test/img.jpg" });
  const merged = mergeDrafts(jsonLdDraft, llmDraft);
  assertEquals(merged.servings, "4");
  assertEquals(merged.imageUrl, "https://example.test/img.jpg");
});
