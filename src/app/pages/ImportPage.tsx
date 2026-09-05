import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { saveRecipe, updateRecipe, getRecipe } from '../lib/recipesApi'
import { useTranslation } from '../lib/i18n/LanguageContext'
import type { RecipeDraft } from '../lib/types'
import { compressImageFile, type CompressedImage } from '../lib/imageResize'
import { sampleVideoFrames } from '../lib/videoFrameSampler'
import { isInstagramOrFacebookUrl } from '../lib/metaUrl'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { BackLink } from '../components/BackLink'
import { LanguageSelector } from '../components/LanguageSelector'

type ImportMode = 'url' | 'photos' | 'text'
type SourceType = 'web' | 'youtube' | 'photo' | 'text' | 'video' | 'instagram' | 'facebook'

type ImportRequestBody =
  | { type: 'url'; url: string }
  | { type: 'text'; text: string }
  | { type: 'images'; images: CompressedImage[] }

const MAX_PHOTOS = 5

interface StagedPhoto {
  id: string
  previewUrl: string
  compressed: CompressedImage
  source: 'photo' | 'video'
}

let stagedPhotoIdCounter = 0
function nextStagedPhotoId(): string {
  stagedPhotoIdCounter += 1
  return `staged-photo-${stagedPhotoIdCounter}`
}

export default function ImportPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { id: editId } = useParams<{ id: string }>()
  const [mode, setMode] = useState<ImportMode>('url')
  const [url, setUrl] = useState('')
  const [pastedText, setPastedText] = useState('')
  const [status, setStatus] = useState<'idle' | 'importing' | 'reviewing' | 'error' | 'saving'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [draft, setDraft] = useState<RecipeDraft | null>(null)
  const [sourceType, setSourceType] = useState<SourceType>('web')
  const [editSourceUrl, setEditSourceUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<StagedPhoto[]>([])
  const [isCompressing, setIsCompressing] = useState(false)
  const [photosError, setPhotosError] = useState<string | null>(null)

  useEffect(() => {
    if (!editId) return
    getRecipe(editId)
      .then((recipe) => {
        setDraft({
          title: recipe.title,
          complexity: recipe.complexity,
          servings: recipe.servings,
          imageUrl: recipe.imageUrl,
          prepMinutes: recipe.prepMinutes,
          cookMinutes: recipe.cookMinutes,
          ingredients: recipe.ingredients.map((i) => ({
            rawText: i.rawText,
            quantity: i.quantity,
            unit: i.unit,
            name: i.name,
          })),
          steps: recipe.steps.map((s) => ({
            instruction: s.instruction,
            estimatedMinutes: s.estimatedMinutes,
            enrichedInstruction: s.enrichedInstruction,
          })),
        })
        setEditSourceUrl(recipe.sourceUrl)
        setSourceType(recipe.sourceType)
        setStatus('reviewing')
      })
      .catch(() => {
        setErrorMessage(t('import.editLoadError'))
        setStatus('error')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  function handleAddPhotoClick() {
    fileInputRef.current?.click()
  }

  async function handlePhotosSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    setIsCompressing(true)
    setPhotosError(null)
    const newPhotos: StagedPhoto[] = []

    function abort(message: string) {
      newPhotos.forEach((p) => {
        if (p.previewUrl.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl)
      })
      setPhotosError(message)
      setIsCompressing(false)
    }

    for (const file of files) {
      const remainingCapacity = MAX_PHOTOS - photos.length - newPhotos.length
      if (remainingCapacity <= 0) break
      if (file.type.startsWith('video/')) {
        try {
          const frames = await sampleVideoFrames(file, remainingCapacity)
          frames.forEach((frame) =>
            newPhotos.push({
              id: nextStagedPhotoId(),
              previewUrl: `data:${frame.mediaType};base64,${frame.data}`,
              compressed: frame,
              source: 'video',
            }),
          )
        } catch {
          abort(t('import.videoProcessingError'))
          return
        }
      } else {
        try {
          const previewUrl = URL.createObjectURL(file)
          newPhotos.push({ id: nextStagedPhotoId(), previewUrl, compressed: await compressImageFile(file), source: 'photo' })
        } catch {
          abort(t('import.photoProcessingError'))
          return
        }
      }
    }
    setPhotos((current) => [...current, ...newPhotos])
    setIsCompressing(false)
  }

  function handleRemovePhoto(index: number) {
    setPhotos((current) => {
      const removed = current[index]
      if (removed.previewUrl.startsWith('blob:')) URL.revokeObjectURL(removed.previewUrl)
      return current.filter((_, i) => i !== index)
    })
  }

  function handlePhotosSubmit(event: FormEvent) {
    event.preventDefault()
    const hasVideoFrame = photos.some((p) => p.source === 'video')
    runImport({ type: 'images', images: photos.map((p) => p.compressed) }, hasVideoFrame ? 'video' : undefined)
  }

  async function runImport(body: ImportRequestBody, sourceTypeOverride?: SourceType) {
    setStatus('importing')
    const { data: sessionData } = await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('server/import', {
      body,
      headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    })
    if (error || !data?.draft) {
      const isRateLimited = error?.context?.status === 429
      const isMetaUrl = body.type === 'url' && isInstagramOrFacebookUrl(body.url)
      setErrorMessage(
        isRateLimited
          ? t('import.rateLimitError')
          : isMetaUrl
            ? t('import.metaImportError')
            : t('import.genericImportError'),
      )
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
    setSourceType(sourceTypeOverride ?? data.sourceType)
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
    const ingredients = draft.ingredients.filter((i) => i.rawText.trim().length > 0)
    const steps = draft.steps.filter((s) => s.instruction.trim().length > 0)
    try {
      if (editId) {
        await updateRecipe(editId, {
          title: draft.title,
          sourceUrl: editSourceUrl,
          sourceType,
          imageUrl: draft.imageUrl,
          complexity: draft.complexity,
          servings: draft.servings,
          prepMinutes: draft.prepMinutes,
          cookMinutes: draft.cookMinutes,
          ingredients,
          steps,
        })
        navigate(`/recipe/${editId}`)
        return
      }
      const id = await saveRecipe({
        title: draft.title,
        sourceUrl: mode === 'url' ? url : null,
        sourceType: mode === 'url' ? sourceType : mode === 'photos' ? (photos.some((p) => p.source === 'video') ? 'video' : 'photo') : 'text',
        imageUrl: draft.imageUrl,
        complexity: draft.complexity,
        servings: draft.servings,
        prepMinutes: draft.prepMinutes,
        cookMinutes: draft.cookMinutes,
        ingredients,
        steps,
      })
      navigate(`/recipe/${id}`)
    } catch {
      setErrorMessage(t('import.genericSaveError'))
      setStatus('error')
    }
  }

  if (editId && status === 'idle') {
    // Avoid a flash of the import-method screen while the existing
    // recipe is still loading for editing.
    return null
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
                <div className="space-y-1">
                  <label htmlFor="url-input" className="sr-only">{t('import.urlLabel')}</label>
                  <Input
                    id="url-input"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    aria-describedby="url-input-hint"
                    required
                  />
                  <p id="url-input-hint" className="text-xs text-muted-foreground">
                    {t('import.urlPlaceholder')}
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={status === 'importing'}>
                  {status === 'importing' ? t('import.importing') : t('import.import')}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="photos" className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={handlePhotosSelected}
              />
              <div className="flex flex-wrap gap-2">
                {photos.map((photo, index) => (
                  <div key={photo.id} className="relative">
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
              <p className="text-xs text-muted-foreground">{t('import.photosHint')}</p>
              <form onSubmit={handlePhotosSubmit}>
                <Button type="submit" className="w-full" disabled={photos.length === 0 || status === 'importing'}>
                  {status === 'importing' ? t('import.extracting') : t('import.extractFromPhotos')}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="text">
              <form onSubmit={handleTextSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor="text-input" className="sr-only">{t('import.textLabel')}</label>
                  <Textarea
                    id="text-input"
                    rows={10}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    aria-describedby="text-input-hint"
                    required
                  />
                  <p id="text-input-hint" className="text-xs text-muted-foreground">
                    {t('import.textPlaceholder')}
                  </p>
                </div>
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
          <BackLink to={editId ? `/recipe/${editId}` : '/'}>{editId ? t('cooking.backLink') : t('import.backLink')}</BackLink>
          <LanguageSelector />
        </div>
        <h1 className="font-serif text-3xl">{editId ? t('import.editHeading') : t('import.reviewHeading')}</h1>
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
                  steps: e.target.value.split('\n').map((line, index) => {
                    const previous = d.steps[index]
                    return {
                      instruction: line,
                      estimatedMinutes: previous?.estimatedMinutes ?? null,
                      // A rewritten instruction that no longer matches the raw
                      // text it was computed from would actively mislead the
                      // user - drop it as soon as this line's text changes.
                      enrichedInstruction: previous?.instruction === line ? previous.enrichedInstruction ?? null : null,
                    }
                  }),
                },
            )
          }
        />

        <Button onClick={handleSave} disabled={status === 'saving'}>
          {status === 'saving' ? t('import.saving') : editId ? t('import.saveChanges') : t('import.saveRecipe')}
        </Button>
      </div>
    </div>
  )
}
