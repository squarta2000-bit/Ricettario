import { supabase } from './supabaseClient'
import type { RecipeListItem, RecipeWithDetails } from './types'

export function sumStepMinutes(steps: { estimated_minutes: number | null }[]): number | null {
  const known = steps.filter((s) => s.estimated_minutes != null)
  if (known.length === 0) return null
  return known.reduce((sum, s) => sum + (s.estimated_minutes as number), 0)
}

export async function listRecipes(): Promise<RecipeListItem[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select('id, title, complexity, prep_minutes, cook_minutes, steps(estimated_minutes)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    complexity: row.complexity,
    prepMinutes: row.prep_minutes,
    cookMinutes: row.cook_minutes,
    totalMinutes: sumStepMinutes(row.steps),
  }))
}

export async function getRecipe(id: string): Promise<RecipeWithDetails> {
  const { data, error } = await supabase
    .from('recipes')
    .select('*, ingredients(*), steps(*)')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return {
    id: data.id,
    ownerId: data.owner_id,
    title: data.title,
    sourceUrl: data.source_url,
    sourceType: data.source_type,
    imageUrl: data.image_url,
    complexity: data.complexity,
    servings: data.servings,
    prepMinutes: data.prep_minutes,
    cookMinutes: data.cook_minutes,
    createdAt: data.created_at,
    ingredients: [...data.ingredients]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        id: i.id,
        recipeId: i.recipe_id,
        position: i.position,
        rawText: i.raw_text,
        quantity: i.quantity,
        unit: i.unit,
        name: i.name,
      })),
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
  }
}

export interface SaveRecipeInput {
  title: string
  sourceUrl: string | null
  sourceType: 'web' | 'youtube' | 'photo' | 'text' | 'video' | 'instagram' | 'facebook'
  imageUrl: string | null
  complexity: string | null
  servings: string | null
  prepMinutes: number | null
  cookMinutes: number | null
  ingredients: { rawText: string; quantity: number | null; unit: string | null; name: string }[]
  steps: { instruction: string; estimatedMinutes: number | null; enrichedInstruction?: string | null }[]
}

function buildIngredientAndStepRows(recipeId: string, input: SaveRecipeInput) {
  const ingredientRows = input.ingredients.map((ing, index) => ({
    recipe_id: recipeId,
    position: index,
    raw_text: ing.rawText,
    quantity: ing.quantity,
    unit: ing.unit,
    name: ing.name,
  }))
  const stepRows = input.steps.map((step, index) => ({
    recipe_id: recipeId,
    position: index,
    instruction: step.instruction,
    estimated_minutes: step.estimatedMinutes,
    enriched_instruction: step.enrichedInstruction ?? null,
  }))
  return { ingredientRows, stepRows }
}

export async function saveRecipe(input: SaveRecipeInput): Promise<string> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Not signed in')

  const { data: recipe, error: recipeError } = await supabase
    .from('recipes')
    .insert({
      owner_id: userData.user.id,
      title: input.title,
      source_url: input.sourceUrl,
      source_type: input.sourceType,
      image_url: input.imageUrl,
      complexity: input.complexity,
      servings: input.servings,
      prep_minutes: input.prepMinutes,
      cook_minutes: input.cookMinutes,
    })
    .select('id')
    .single()
  if (recipeError) throw new Error(recipeError.message)

  const { ingredientRows, stepRows } = buildIngredientAndStepRows(recipe.id, input)
  const [ingredientsResult, stepsResult] = await Promise.all([
    supabase.from('ingredients').insert(ingredientRows),
    supabase.from('steps').insert(stepRows),
  ])
  if (ingredientsResult.error) throw new Error(ingredientsResult.error.message)
  if (stepsResult.error) throw new Error(stepsResult.error.message)

  return recipe.id as string
}

export async function updateRecipe(id: string, input: SaveRecipeInput): Promise<void> {
  const { error: recipeError } = await supabase
    .from('recipes')
    .update({
      title: input.title,
      source_url: input.sourceUrl,
      source_type: input.sourceType,
      image_url: input.imageUrl,
      complexity: input.complexity,
      servings: input.servings,
      prep_minutes: input.prepMinutes,
      cook_minutes: input.cookMinutes,
    })
    .eq('id', id)
  if (recipeError) throw new Error(recipeError.message)

  // Ingredients/steps have no stable identity from the edit form (just
  // reordered lines of text), so the simplest correct approach is to
  // replace the full set rather than trying to diff it against what's
  // already stored.
  const [deletedIngredients, deletedSteps] = await Promise.all([
    supabase.from('ingredients').delete().eq('recipe_id', id),
    supabase.from('steps').delete().eq('recipe_id', id),
  ])
  if (deletedIngredients.error) throw new Error(deletedIngredients.error.message)
  if (deletedSteps.error) throw new Error(deletedSteps.error.message)

  const { ingredientRows, stepRows } = buildIngredientAndStepRows(id, input)
  const [ingredientsResult, stepsResult] = await Promise.all([
    supabase.from('ingredients').insert(ingredientRows),
    supabase.from('steps').insert(stepRows),
  ])
  if (ingredientsResult.error) throw new Error(ingredientsResult.error.message)
  if (stepsResult.error) throw new Error(stepsResult.error.message)
}

export async function deleteRecipe(id: string): Promise<void> {
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
