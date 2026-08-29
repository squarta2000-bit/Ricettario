import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { getRecipe } from '../lib/recipesApi'
import type { RecipeWithDetails } from '../lib/types'
import { Button } from '../components/ui/button'

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [recipe, setRecipe] = useState<RecipeWithDetails | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (id)
      getRecipe(id)
        .then(setRecipe)
        .catch(() => setError('Something went wrong loading this recipe.'))
  }, [id])

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="max-w-xl w-full px-4 text-center">
          <p className="text-destructive text-sm mb-4">{error}</p>
          <Button asChild variant="outline">
            <Link to="/">Back to recipes</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (!recipe) return null

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-normal">{recipe.title}</h1>
            {recipe.complexity && (
              <p className="text-sm text-muted-foreground">{recipe.complexity}</p>
            )}
          </div>
          {recipe.sourceUrl && (
            <a
              href={recipe.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Source <ExternalLink className="size-4" />
            </a>
          )}
        </div>

        <Button asChild className="mb-8">
          <Link to={`/recipe/${recipe.id}/cook`}>Start cooking</Link>
        </Button>

        <h2 className="font-medium mb-2">Ingredients</h2>
        <ul className="mb-8 space-y-1">
          {recipe.ingredients.map((ing) => (
            <li key={ing.id} className="text-sm">
              {ing.quantity != null ? `${ing.quantity} ${ing.unit ?? ''} ` : ''}
              {ing.name}
            </li>
          ))}
        </ul>

        <h2 className="font-medium mb-2">Steps</h2>
        <ol className="space-y-3 list-decimal list-inside">
          {recipe.steps.map((step) => (
            <li key={step.id} className="text-sm">
              {step.instruction}
              {step.estimatedMinutes != null && (
                <span className="text-muted-foreground"> ({step.estimatedMinutes} min)</span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
