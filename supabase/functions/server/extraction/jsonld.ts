import type { RecipeDraft } from "./types.ts";

interface SchemaOrgRecipe {
  "@type"?: string | string[];
  name?: string;
  recipeIngredient?: string[];
  recipeInstructions?: unknown;
  totalTime?: string;
  recipeYield?: string | string[];
  image?: string | { url?: string } | string[];
}

function isRecipeType(type: string | string[] | undefined): boolean {
  if (!type) return false;
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => t.toLowerCase() === "recipe");
}

function extractInstructionText(instructions: unknown): string[] {
  if (!instructions) return [];
  if (typeof instructions === "string") {
    return instructions.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(instructions)) {
    return instructions
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in (item as Record<string, unknown>)) {
          return String((item as { text: unknown }).text);
        }
        return "";
      })
      .filter(Boolean);
  }
  return [];
}

function parseIsoDurationToMinutes(iso: string | undefined): number | null {
  if (!iso) return null;
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const total = days * 24 * 60 + hours * 60 + minutes;
  return total > 0 ? total : null;
}

export function findRecipeJsonLd(html: string): SchemaOrgRecipe | null {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const graph = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] ?? [])];
      for (const candidate of graph) {
        if (candidate && isRecipeType(candidate["@type"])) {
          return candidate as SchemaOrgRecipe;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function jsonLdToDraft(recipe: SchemaOrgRecipe): RecipeDraft | null {
  const ingredients = recipe.recipeIngredient ?? [];
  const instructions = extractInstructionText(recipe.recipeInstructions);
  if (ingredients.length === 0 || instructions.length === 0) return null;

  const totalMinutes = parseIsoDurationToMinutes(recipe.totalTime);
  const perStepMinutes = totalMinutes ? Math.max(1, Math.round(totalMinutes / instructions.length)) : null;

  let imageUrl: string | null = null;
  if (typeof recipe.image === "string") imageUrl = recipe.image;
  else if (Array.isArray(recipe.image) && typeof recipe.image[0] === "string") imageUrl = recipe.image[0];
  else if (recipe.image && typeof recipe.image === "object" && "url" in recipe.image) {
    imageUrl = (recipe.image as { url?: string }).url ?? null;
  }

  return {
    title: recipe.name ?? "Untitled recipe",
    complexity: null,
    servings: Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] ?? null : recipe.recipeYield ?? null,
    imageUrl,
    ingredients: ingredients.map((raw) => ({ rawText: raw, quantity: null, unit: null, name: raw })),
    steps: instructions.map((instruction) => ({ instruction, estimatedMinutes: perStepMinutes })),
  };
}
