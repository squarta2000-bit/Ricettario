import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { saveRecipe } from '../lib/recipesApi'
import type { RecipeDraft } from '../lib/types'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'

export default function ImportPage() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'importing' | 'reviewing' | 'error' | 'saving'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [draft, setDraft] = useState<RecipeDraft | null>(null)
  const [sourceType, setSourceType] = useState<'web' | 'youtube'>('web')

  async function handleImport(event: FormEvent) {
    event.preventDefault()
    setStatus('importing')
    const { data: sessionData } = await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('server/import', {
      body: { url },
      headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    })
    if (error || !data?.draft) {
      let message = 'Import failed. You can still fill this in manually.'
      if (error) {
        try {
          const body = await error.context.json()
          if (body?.error) message = body.error
        } catch {
          // fall back to the generic message above
        }
      }
      setErrorMessage(message)
      setDraft({ title: '', complexity: null, servings: null, imageUrl: null, ingredients: [], steps: [] })
      setStatus('error')
      return
    }
    setDraft(data.draft)
    setSourceType(data.sourceType)
    setStatus('reviewing')
  }

  async function handleSave() {
    if (!draft) return
    setStatus('saving')
    try {
      const id = await saveRecipe({
        title: draft.title,
        sourceUrl: url,
        sourceType,
        imageUrl: draft.imageUrl,
        complexity: draft.complexity,
        servings: draft.servings,
        ingredients: draft.ingredients,
        steps: draft.steps,
      })
      navigate(`/recipe/${id}`)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Save failed. Please try again.')
      setStatus('error')
    }
  }

  if (status === 'idle' || status === 'importing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <form onSubmit={handleImport} className="w-full max-w-md space-y-4 px-4">
          <h1 className="text-2xl font-normal text-center">Import a recipe</h1>
          <Input
            placeholder="https://example.com/recipe or a YouTube URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <Button type="submit" className="w-full" disabled={status === 'importing'}>
            {status === 'importing' ? 'Importing…' : 'Import'}
          </Button>
        </form>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        <h1 className="text-2xl font-normal">Review before saving</h1>
        {status === 'error' && <p className="text-destructive text-sm">{errorMessage}</p>}

        <label className="block text-sm font-medium">Title</label>
        <Input value={draft?.title ?? ''} onChange={(e) => setDraft((d) => d && { ...d, title: e.target.value })} />

        <label className="block text-sm font-medium">Ingredients (one per line)</label>
        <Textarea
          rows={8}
          value={(draft?.ingredients ?? []).map((i) => i.rawText).join('\n')}
          onChange={(e) =>
            setDraft(
              (d) =>
                d && {
                  ...d,
                  ingredients: e.target.value
                    .split('\n')
                    .filter(Boolean)
                    .map((line) => ({ rawText: line, quantity: null, unit: null, name: line })),
                },
            )
          }
        />

        <label className="block text-sm font-medium">Steps (one per line)</label>
        <Textarea
          rows={10}
          value={(draft?.steps ?? []).map((s) => s.instruction).join('\n')}
          onChange={(e) =>
            setDraft(
              (d) =>
                d && {
                  ...d,
                  steps: e.target.value
                    .split('\n')
                    .filter(Boolean)
                    .map((line, index) => ({
                      instruction: line,
                      estimatedMinutes: d.steps[index]?.estimatedMinutes ?? null,
                    })),
                },
            )
          }
        />

        <Button onClick={handleSave} disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : 'Save recipe'}
        </Button>
      </div>
    </div>
  )
}
