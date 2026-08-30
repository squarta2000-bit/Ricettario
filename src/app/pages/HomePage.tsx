import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LayoutGrid, List as ListIcon } from 'lucide-react'
import { listRecipes } from '../lib/recipesApi'
import { supabase } from '../lib/supabaseClient'
import { formatRecipeDuration } from '../lib/formatDuration'
import { useTranslation } from '../lib/i18n/LanguageContext'
import type { RecipeListItem } from '../lib/types'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { LanguageSelector } from '../components/LanguageSelector'

type ViewMode = 'card' | 'list'

const VIEW_MODE_STORAGE_KEY = 'ricettario:home-view-mode'

function loadStoredViewMode(): ViewMode {
  return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'card'
}

export default function HomePage() {
  const { t } = useTranslation()
  const [recipes, setRecipes] = useState<RecipeListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(loadStoredViewMode)

  useEffect(() => {
    listRecipes()
      .then(setRecipes)
      .catch(() => setError(t('home.loadError')))
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectViewMode(mode: ViewMode) {
    setViewMode(mode)
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
  }

  const durationLabels = { prep: t('duration.prep'), cook: t('duration.cook') }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-serif">Ricettario</h1>
          <div className="flex gap-2">
            <LanguageSelector />
            <div className="flex gap-1" role="group" aria-label={t('home.viewMode')}>
              <Button
                variant={viewMode === 'card' ? 'secondary' : 'outline'}
                size="icon"
                aria-label={t('home.cardView')}
                aria-pressed={viewMode === 'card'}
                onClick={() => selectViewMode('card')}
              >
                <LayoutGrid />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'outline'}
                size="icon"
                aria-label={t('home.listView')}
                aria-pressed={viewMode === 'list'}
                onClick={() => selectViewMode('list')}
              >
                <ListIcon />
              </Button>
            </div>
            <Button asChild>
              <Link to="/import">{t('home.importRecipe')}</Link>
            </Button>
            <Button variant="outline" onClick={() => supabase.auth.signOut()}>
              {t('home.signOut')}
            </Button>
          </div>
        </div>

        {error && <p className="text-destructive text-sm mb-4">{error}</p>}

        {!isLoading && !error && recipes.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-xl mb-2">{t('home.emptyTitle')}</p>
            <p>{t('home.emptySubtitle')}</p>
          </div>
        )}

        {viewMode === 'card' ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recipes.map((recipe) => (
              <Link key={recipe.id} to={`/recipe/${recipe.id}`}>
                <Card className="p-4 h-full hover:bg-accent transition-colors">
                  <h2 className="font-serif text-lg mb-1">{recipe.title}</h2>
                  <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                    {formatRecipeDuration(recipe, durationLabels) ?? t('home.timeUnknown')}
                    {recipe.complexity ? ` · ${recipe.complexity}` : ''}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <div className="border-t border-border">
            {recipes.map((recipe) => (
              <Link
                key={recipe.id}
                to={`/recipe/${recipe.id}`}
                className="flex items-center justify-between gap-4 py-3 border-b border-border hover:bg-accent/50 transition-colors -mx-2 px-2 rounded-md"
              >
                <h2 className="font-serif text-lg truncate">{recipe.title}</h2>
                <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                  {formatRecipeDuration(recipe, durationLabels) ?? t('home.timeUnknown')}
                  {recipe.complexity ? ` · ${recipe.complexity}` : ''}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
