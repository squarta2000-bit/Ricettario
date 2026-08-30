import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { saveRecipe } from '../lib/recipesApi'
import { useTranslation } from '../lib/i18n/LanguageContext'
import type { RecipeDraft } from '../lib/types'
import { compressImageFile, type CompressedImage } from '../lib/imageResize'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { BackLink } from '../components/BackLink'
import { LanguageSelector } from '../components/LanguageSelector'

type ImportMode = 'url' | 'photos' | 'text'
type SourceType = 'web' | 'youtube' | 'photo' | 'text'

type ImportRequestBody =
  | { type: 'url'; url: string }
  | { type: 'text'; text: string }
  | { type: 'images'; images: CompressedImage[] }

const MAX_PHOTOS = 5

interface StagedPhoto {
  previewUrl: string
  compressed: CompressedImage
}

export default function ImportPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [mode, setMode] = useState<ImportMode>('url')
  const [url, setUrl] = useState('')
  const [pastedText, setPastedText] = useState('')
  const [status, setStatus] = useState<'idle' | 'importing' | 'reviewing' | 'error' | 'saving'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [draft, setDraft] = useState<RecipeDraft | null>(null)
  const [sourceType, setSourceType] = useState<SourceType>('web')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<StagedPhoto[]>([])
  const [isCompressing, setIsCompressing] = useState(false)
  const [photosError, setPhotosError] = useState<string | null>(null)

  function handleAddPhotoClick() {
    fileInputRef.current?.click()
  }

  async function handlePhotosSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    const remainingCapacity = MAX_PHOTOS - photos.length
    const filesToAdd = files.slice(0, remainingCapacity)

    setIsCompressing(true)
    setPhotosError(null)
    const createdPreviewUrls: string[] = []
    try {
      const newPhotos = await Promise.all(
        filesToAdd.map(async (file) => {
          const previewUrl = URL.createObjectURL(file)
          createdPreviewUrls.push(previewUrl)
          return { previewUrl, compressed: await compressImageFile(file) }
        }),
      )
      setPhotos((current) => [...current, ...newPhotos])
    } catch (err) {
      createdPreviewUrls.forEach((url) => URL.revokeObjectURL(url))
      setPhotosError(err instanceof Error ? err.message : t('import.photoProcessingError'))
    } finally {
      setIsCompressing(false)
    }
  }

  function handleRemovePhoto(index: number) {
    setPhotos((current) => {
      URL.revokeObjectURL(current[index].previewUrl)
      return current.filter((_, i) => i !== index)
    })
  }

  function handlePhotosSubmit(event: FormEvent) {
    event.preventDefault()
    runImport({ type: 'images', images: photos.map((p) => p.compressed) })
  }

  async function runImport(body: ImportRequestBody) {
    setStatus('importing')
    const { data: sessionData } = await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('server/import', {
      body,
      headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    })
    if (error || !data?.draft) {
      let message = t('import.genericImportError')
      if (error) {
        try {
          const errorBody = await error.context.json()
          if (errorBody?.error) message = errorBody.error
        } catch {
          // fall back to the generic message above
        }
      }
      setErrorMessage(message)
      setDraft({
        title: '',
        complexity: null,
        servings: null,
        imageUrl: null,
        prepMinutes: null,
        cookMinutes: null,
        ingredients: [],
        steps: [],
      })
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
        sourceType: mode === 'url' ? sourceType : mode === 'photos' ? 'photo' : 'text',
        imageUrl: draft.imageUrl,
        complexity: draft.complexity,
        servings: draft.servings,
        prepMinutes: draft.prepMinutes,
        cookMinutes: draft.cookMinutes,
        ingredients: draft.ingredients,
        steps: draft.steps,
      })
      navigate(`/recipe/${id}`)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t('import.genericSaveError'))
      setStatus('error')
    }
  }

  if (status === 'idle' || status === 'importing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-md space-y-4 px-4">
          <div className="flex items-center justify-between">
            <BackLink to="/">{t('import.backLink')}</BackLink>
            <LanguageSelector />
          </div>
          <h1 className="font-serif text-3xl text-center">{t('import.heading')}</h1>
          <Tabs value={mode} onValueChange={(value) => setMode(value as ImportMode)}>
            <TabsList className="w-full">
              <TabsTrigger value="url" className="flex-1">{t('import.tabUrl')}</TabsTrigger>
              <TabsTrigger value="photos" className="flex-1">{t('import.tabPhotos')}</TabsTrigger>
              <TabsTrigger value="text" className="flex-1">{t('import.tabText')}</TabsTrigger>
            </TabsList>
            <TabsContent value="url">
              <form onSubmit={handleUrlSubmit} className="space-y-4">
                <Input
                  placeholder={t('import.urlPlaceholder')}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
                <Button type="submit" className="w-full" disabled={status === 'importing'}>
                  {status === 'importing' ? t('import.importing') : t('import.import')}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="photos" className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={handlePhotosSelected}
              />
              <div className="flex flex-wrap gap-2">
                {photos.map((photo, index) => (
                  <div key={photo.previewUrl} className="relative">
                    <img
                      src={photo.previewUrl}
                      alt={t('import.photoAlt', { n: index + 1 })}
                      className="size-20 object-cover rounded-md"
                    />
                    <button
                      type="button"
                      aria-label={t('import.removePhoto', { n: index + 1 })}
                      onClick={() => handleRemovePhoto(index)}
                      className="absolute -top-2 -right-2 flex items-center justify-center size-5 rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
              {photosError && <p className="text-destructive text-sm">{photosError}</p>}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleAddPhotoClick}
                disabled={photos.length >= MAX_PHOTOS || isCompressing}
              >
                {isCompressing ? t('import.processing') : t('import.addPhoto')}
              </Button>
              <form onSubmit={handlePhotosSubmit}>
                <Button type="submit" className="w-full" disabled={photos.length === 0 || status === 'importing'}>
                  {status === 'importing' ? t('import.extracting') : t('import.extractFromPhotos')}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="text">
              <form onSubmit={handleTextSubmit} className="space-y-4">
                <Textarea
                  placeholder={t('import.textPlaceholder')}
                  rows={10}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  required
                />
                <Button type="submit" className="w-full" disabled={status === 'importing'}>
                  {status === 'importing' ? t('import.extracting') : t('import.extractFromText')}
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
        <div className="flex items-center justify-between">
          <BackLink to="/">{t('import.backLink')}</BackLink>
          <LanguageSelector />
        </div>
        <h1 className="font-serif text-3xl">{t('import.reviewHeading')}</h1>
        {status === 'error' && <p className="text-destructive text-sm">{errorMessage}</p>}

        <label htmlFor="draft-title" className="block text-sm font-medium">{t('import.titleLabel')}</label>
        <Input
          id="draft-title"
          value={draft?.title ?? ''}
          onChange={(e) => setDraft((d) => d && { ...d, title: e.target.value })}
        />

        <label htmlFor="draft-ingredients" className="block text-sm font-medium">{t('import.ingredientsLabel')}</label>
        <Textarea
          id="draft-ingredients"
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

        <label htmlFor="draft-steps" className="block text-sm font-medium">{t('import.stepsLabel')}</label>
        <Textarea
          id="draft-steps"
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
          {status === 'saving' ? t('import.saving') : t('import.saveRecipe')}
        </Button>
      </div>
    </div>
  )
}
