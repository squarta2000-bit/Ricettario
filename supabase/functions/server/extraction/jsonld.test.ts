import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findRecipeJsonLd, jsonLdToDraft } from "./jsonld.ts";

const HTML_WITH_RECIPE = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Tomato Soup",
  "recipeYield": "4 servings",
  "totalTime": "PT30M",
  "recipeIngredient": ["2 cans tomatoes", "1 onion"],
  "recipeInstructions": [
    { "@type": "HowToStep", "text": "Chop the onion." },
    { "@type": "HowToStep", "text": "Simmer everything for 20 minutes." }
  ]
}
</script>
</head><body></body></html>
`;

const HTML_WITHOUT_RECIPE = `<html><body><p>Just a blog post, no recipe markup.</p></body></html>`;

Deno.test("findRecipeJsonLd finds a Recipe block among other JSON-LD", () => {
  const recipe = findRecipeJsonLd(HTML_WITH_RECIPE);
  assertExists(recipe);
  assertEquals(recipe?.name, "Tomato Soup");
});

Deno.test("findRecipeJsonLd returns null when there is no Recipe block", () => {
  assertEquals(findRecipeJsonLd(HTML_WITHOUT_RECIPE), null);
});

Deno.test("jsonLdToDraft maps ingredients, steps, servings, and splits totalTime evenly", () => {
  const recipe = findRecipeJsonLd(HTML_WITH_RECIPE);
  const draft = jsonLdToDraft(recipe!);
  assertExists(draft);
  assertEquals(draft?.title, "Tomato Soup");
  assertEquals(draft?.servings, "4 servings");
  assertEquals(draft?.ingredients.length, 2);
  assertEquals(draft?.steps.length, 2);
  assertEquals(draft?.steps[0].estimatedMinutes, 15); // 30 min / 2 steps
  assertEquals(draft?.cookMinutes, 30);
  assertEquals(draft?.prepMinutes, null);
});

Deno.test("jsonLdToDraft returns null when ingredients or instructions are missing", () => {
  const draft = jsonLdToDraft({ "@type": "Recipe", name: "Empty" });
  assertEquals(draft, null);
});

Deno.test("jsonLdToDraft reads prepTime and cookTime separately when both are given", () => {
  const draft = jsonLdToDraft({
    "@type": "Recipe",
    name: "Lasagne",
    prepTime: "PT40M",
    cookTime: "PT2H",
    recipeIngredient: ["pasta", "ragu"],
    recipeInstructions: ["Make the ragu.", "Assemble.", "Bake."],
  });
  assertExists(draft);
  assertEquals(draft?.prepMinutes, 40);
  assertEquals(draft?.cookMinutes, 120);
  // 160 total across 3 steps must sum back EXACTLY - no rounding drift.
  const stepSum = draft!.steps.reduce((sum, s) => sum + (s.estimatedMinutes ?? 0), 0);
  assertEquals(stepSum, 160);
  assertEquals(draft?.steps[0].estimatedMinutes, 54); // floor(160/3)+1 (remainder step)
  assertEquals(draft?.steps[1].estimatedMinutes, 53);
  assertEquals(draft?.steps[2].estimatedMinutes, 53);
});

Deno.test("jsonLdToDraft derives cookTime from totalTime minus prepTime when cookTime is absent", () => {
  const draft = jsonLdToDraft({
    "@type": "Recipe",
    name: "Bread",
    prepTime: "PT20M",
    totalTime: "PT50M",
    recipeIngredient: ["flour"],
    recipeInstructions: ["Knead.", "Bake."],
  });
  assertExists(draft);
  assertEquals(draft?.prepMinutes, 20);
  assertEquals(draft?.cookMinutes, 30);
});

Deno.test("jsonLdToDraft never invents a complexity value", () => {
  const recipe = findRecipeJsonLd(HTML_WITH_RECIPE);
  const draft = jsonLdToDraft(recipe!);
  assertEquals(draft?.complexity, null);
});
