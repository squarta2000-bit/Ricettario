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
