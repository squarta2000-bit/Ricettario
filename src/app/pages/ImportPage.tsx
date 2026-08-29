import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { saveRecipe } from '../lib/recipesApi'
import type { RecipeDraft } from '../lib/types'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

type ImportMode = 'url' | 'text'
type SourceType = 'web' | 'youtube' | 'text'

type ImportRequestBody = { type: 'url'; url: string } | { type: 'text'; text: string }

export default function ImportPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<ImportMode>('url')
  const [url, setUrl] = useState('')
  const [pastedText, setPastedText] = useState('')
  const [status, setStatus] = useState<'idle' | 'importing' | 'reviewing' | 'error' | 'saving'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [draft, setDraft] = useState<RecipeDraft | null>(null)
  const [sourceType, setSourceType] = useState<SourceType>('web')

  async function runImport(body: ImportRequestBody) {
    setStatus('importing')
    const { data: sessionData } = await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('server/import', {
      body,
      headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    })
    if (error || !data?.draft) {
      let message = 'Import failed. You can still fill this in manually.'
      if (error) {
        try {
          const errorBody = await error.context.json()
          if (errorBody?.error) message = errorBody.error
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

  function handleUrlSubmit(event: FormEvent) {
    event.preventDefault()
    runImport({ type: 'url', url })
  }

  function handleTextSubmit(event: FormEvent) {
    event.preventDefault()
    runImport({ type: 'text', text: pastedText })
  }

  async function handleSave() {
    if (!draft) return
    setStatus('saving')
    try {
      const id = await saveRecipe({
        title: draft.title,
        sourceUrl: mode === 'url' ? url : null,
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
        <div className="w-full max-w-md space-y-4 px-4">
          <h1 className="text-2xl font-normal text-center">Import a recipe</h1>
          <Tabs value={mode} onValueChange={(value) => setMode(value as ImportMode)}>
            <TabsList className="w-full">
              <TabsTrigger value="url" className="flex-1">From URL</TabsTrigger>
              <TabsTrigger value="text" className="flex-1">Paste Text</TabsTrigger>
            </TabsList>
            <TabsContent value="url">
              <form onSubmit={handleUrlSubmit} className="space-y-4">
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
            </TabsContent>
            <TabsContent value="text">
              <form onSubmit={handleTextSubmit} className="space-y-4">
                <Textarea
                  placeholder="Paste the recipe text here"
                  rows={10}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  required
                />
                <Button type="submit" className="w-full" disabled={status === 'importing'}>
                  {status === 'importing' ? 'Extracting…' : 'Extract recipe from text'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
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
