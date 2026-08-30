export interface RecipeDraft {
  title: string
  complexity: string | null
  servings: string | null
  imageUrl: string | null
  prepMinutes: number | null
  cookMinutes: number | null
  ingredients: { rawText: string; quantity: number | null; unit: string | null; name: string }[]
  steps: { instruction: string; estimatedMinutes: number | null }[]
}
