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
});

Deno.test("jsonLdToDraft returns null when ingredients or instructions are missing", () => {
  const draft = jsonLdToDraft({ "@type": "Recipe", name: "Empty" });
  assertEquals(draft, null);
});
