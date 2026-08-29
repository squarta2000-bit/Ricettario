export interface Ingredient {
  id: string
  recipeId: string
  position: number
  rawText: string
  quantity: number | null
  unit: string | null
  name: string
}

export interface Step {
  id: string
  recipeId: string
  position: number
  instruction: string
  estimatedMinutes: number | null
}

export interface Recipe {
  id: string
  ownerId: string
  title: string
  sourceUrl: string | null
  sourceType: 'web' | 'youtube' | 'photo' | 'text'
  imageUrl: string | null
  complexity: string | null
  servings: string | null
  createdAt: string
}

export interface RecipeWithDetails extends Recipe {
  ingredients: Ingredient[]
  steps: Step[]
}

export interface RecipeListItem {
  id: string
  title: string
  complexity: string | null
  totalMinutes: number | null
}

// Mirrors supabase/functions/server/extraction/types.ts — the edge function's
// response shape. Duplicated (not imported) because the edge function runs on
// Deno and the frontend on Vite/Node; keep the two in sync by hand.
export interface RecipeDraftIngredient {
  rawText: string
  quantity: number | null
  unit: string | null
  name: string
}

export interface RecipeDraftStep {
  instruction: string
  estimatedMinutes: number | null
}

export interface RecipeDraft {
  title: string
  complexity: string | null
  servings: string | null
  imageUrl: string | null
  ingredients: RecipeDraftIngredient[]
  steps: RecipeDraftStep[]
}
