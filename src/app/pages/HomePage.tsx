import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LayoutGrid, List as ListIcon, Pencil, Trash2 } from 'lucide-react'
import { listRecipes, deleteRecipe } from '../lib/recipesApi'
import { supabase } from '../lib/supabaseClient'
import { formatRecipeDuration } from '../lib/formatDuration'
import { useTranslation } from '../lib/i18n/LanguageContext'
import type { RecipeListItem } from '../lib/types'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { LanguageSelector } from '../components/LanguageSelector'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'

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
  const [deleteTarget, setDeleteTarget] = useState<RecipeListItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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

  async function confirmDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteRecipe(deleteTarget.id)
      setRecipes((current) => current.filter((r) => r.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch {
      setDeleteError(t('home.deleteError'))
    } finally {
      setIsDeleting(false)
    }
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
        {deleteError && <p className="text-destructive text-sm mb-4">{deleteError}</p>}

        {!isLoading && !error && recipes.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-xl mb-2">{t('home.emptyTitle')}</p>
            <p>{t('home.emptySubtitle')}</p>
          </div>
        )}

        {viewMode === 'card' ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recipes.map((recipe) => (
              <Card key={recipe.id} className="p-4 h-full flex flex-col">
                <Link to={`/recipe/${recipe.id}`} className="flex-1 -m-1 p-1 rounded-md hover:bg-accent transition-colors">
                  <h2 className="font-serif text-lg mb-1">{recipe.title}</h2>
                  <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                    {formatRecipeDuration(recipe, durationLabels) ?? t('home.timeUnknown')}
                    {recipe.complexity ? ` · ${t('duration.difficulty')} ${recipe.complexity}` : ''}
                  </p>
                </Link>
                <div className="flex gap-2 mt-3">
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/recipe/${recipe.id}/edit`}>
                      <Pencil /> {t('home.edit')}
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDeleteTarget(recipe)}>
                    <Trash2 /> {t('home.delete')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="border-t border-border">
            {recipes.map((recipe) => (
              <div key={recipe.id} className="flex items-center justify-between gap-4 py-2 border-b border-border">
                <Link
                  to={`/recipe/${recipe.id}`}
                  className="flex items-center justify-between gap-4 flex-1 min-w-0 py-1 px-2 -mx-2 rounded-md hover:bg-accent/50 transition-colors"
                >
                  <h2 className="font-serif text-lg truncate">{recipe.title}</h2>
                  <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                    {formatRecipeDuration(recipe, durationLabels) ?? t('home.timeUnknown')}
                    {recipe.complexity ? ` · ${t('duration.difficulty')} ${recipe.complexity}` : ''}
                  </p>
                </Link>
                <div className="flex gap-1 shrink-0">
                  <Button asChild size="icon" variant="outline" aria-label={t('home.edit')}>
                    <Link to={`/recipe/${recipe.id}/edit`}>
                      <Pencil />
                    </Link>
                  </Button>
                  <Button size="icon" variant="outline" aria-label={t('home.delete')} onClick={() => setDeleteTarget(recipe)}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('home.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && t('home.deleteConfirmDescription', { title: deleteTarget.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('home.deleteConfirmCancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={isDeleting}>
              {t('home.deleteConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
