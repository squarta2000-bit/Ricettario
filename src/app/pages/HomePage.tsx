import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listRecipes } from '../lib/recipesApi'
import { supabase } from '../lib/supabaseClient'
import { formatRecipeDuration } from '../lib/formatDuration'
import type { RecipeListItem } from '../lib/types'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'

export default function HomePage() {
  const [recipes, setRecipes] = useState<RecipeListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listRecipes()
      .then(setRecipes)
      .catch(() => setError('Something went wrong loading your recipes.'))
      .finally(() => setIsLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-serif">Ricettario</h1>
          <div className="flex gap-2">
            <Button asChild>
              <Link to="/import">Import recipe</Link>
            </Button>
            <Button variant="outline" onClick={() => supabase.auth.signOut()}>
              Sign out
            </Button>
          </div>
        </div>

        {error && <p className="text-destructive text-sm mb-4">{error}</p>}

        {!isLoading && !error && recipes.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-xl mb-2">No recipes yet</p>
            <p>Import your first recipe from a URL or YouTube video.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((recipe) => (
            <Link key={recipe.id} to={`/recipe/${recipe.id}`}>
              <Card className="p-4 h-full hover:bg-accent transition-colors">
                <h2 className="font-serif text-lg mb-1">{recipe.title}</h2>
                <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                  {formatRecipeDuration(recipe) ?? 'Time unknown'}
                  {recipe.complexity ? ` · ${recipe.complexity}` : ''}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
