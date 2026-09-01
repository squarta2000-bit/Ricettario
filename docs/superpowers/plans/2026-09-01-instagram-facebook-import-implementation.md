# Instagram/Facebook Reel Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users import a recipe from an Instagram/Facebook Reel, either by uploading the video/screenshots themselves (frame-sampled client-side, reusing the existing photo pipeline) or by pasting a Reel URL (caption fetched via Meta's oEmbed API, reusing the existing text pipeline).

**Architecture:** Two independent additions to the existing `/server/import` + `ImportPage.tsx` flow. Phase 1 (manual upload) samples video frames entirely in the browser via `<video>`+`<canvas>` and reuses the existing `images` request path untouched — no backend change. Phase 2 (URL/caption) adds a new backend branch that detects Instagram/Facebook URLs, fetches the post's caption via Meta's Graph oEmbed API, and feeds it into the existing text-LLM extractor — the same shape as the YouTube description fallback.

**Tech Stack:** React 18 + Vite frontend, Supabase Edge Function (Hono on Deno) backend, Vitest (frontend unit tests), Deno's built-in test runner (backend unit tests), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-09-01-instagram-facebook-import-design.md`

## Global Constraints

- Phase 1 makes **zero backend changes** — all video handling happens client-side. Do not touch `supabase/functions/server/**` in Tasks 1-5.
- No audio transcription in this iteration — frames + optional caption text only (per the approved spec).
- **Never show raw server/SDK error text to the user.** Every user-facing error message must come from a translated `t('...')` key — this session already fixed several raw-text leaks in `LoginPage.tsx`/`ImportPage.tsx`; do not reintroduce the pattern.
- Every new translation key must be added to **all three languages** (`en`, `it`, `fr`) in `src/app/lib/i18n/translations.ts` — `translations.test.ts` asserts the three dictionaries have identical key sets, so a missing translation is a hard test failure, not a silent gap.
- Any new/changed UI must be verified with a Playwright screenshot saved under `./screenshot/` (per this session's explicit instruction), in addition to whatever assertions the test makes.
- Phase 2's happy path (a real Instagram/Facebook post → a real extracted draft) cannot be fully verified in this environment: it needs a Meta developer app's credentials, set as edge function secrets, and the edge function redeployed with Task 7's changes — steps only the project owner can do (see Task 7's final steps). Task 9's E2E test instead verifies the deterministic, deployment-independent part: that a failure on an Instagram/Facebook URL shows the specific fallback message pointing at the upload path, not the generic one.
- Existing migrations run up to `0005_add_prep_cook_minutes.sql` — the new migration in this plan is `0006_...`, not `0005_...` as an earlier draft of the spec assumed.

---

## Phase 1: Manual upload (video → frames), no backend changes

### Task 1: Widen the `source_type` DB constraint

**Files:**
- Create: `supabase/migrations/0006_widen_import_source_types_reels.sql`

**Interfaces:**
- Produces: the `recipes.source_type` column now accepts `'video'`, `'instagram'`, `'facebook'` in addition to the existing `'web' | 'youtube' | 'photo' | 'text'`. Later tasks (3, 7) rely on being able to save/read recipes with these values without violating the check constraint.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0006_widen_import_source_types_reels.sql
-- Adds source types for Instagram/Facebook Reel import: 'video' (manual
-- upload path, frame-sampled client-side) and 'instagram'/'facebook' (URL
-- path, caption fetched via Meta's oEmbed API). See
-- docs/superpowers/specs/2026-09-01-instagram-facebook-import-design.md.
alter table recipes drop constraint if exists recipes_source_type_check;
alter table recipes add constraint recipes_source_type_check
  check (source_type in ('web', 'youtube', 'photo', 'text', 'video', 'instagram', 'facebook'));
```

- [ ] **Step 2: Apply the migration locally and verify**

Run: `supabase db reset`
Expected: migration applies with no errors; `supabase db reset` output lists `0006_widen_import_source_types_reels.sql` as applied.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0006_widen_import_source_types_reels.sql
git commit -m "feat: widen recipes.source_type to allow video/instagram/facebook"
```

*(Once verified against the hosted project too, apply there with `supabase db push` — do this only after local verification passes, per this repo's established migration workflow.)*

---

### Task 2: `videoFrameSampler.ts` — client-side frame extraction

**Files:**
- Create: `src/app/lib/videoFrameSampler.ts`
- Test: `src/app/lib/videoFrameSampler.test.ts`

**Interfaces:**
- Consumes: `computeResizedDimensions` and `CompressedImage` from `src/app/lib/imageResize.ts` (existing, unchanged).
- Produces: `computeSampleTimestamps(durationSeconds: number, frameCount: number): number[]` (pure) and `sampleVideoFrames(file: File, frameCount: number, maxDimension?: number, quality?: number): Promise<CompressedImage[]>` (DOM-touching). Task 3 imports `sampleVideoFrames` from this module.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/lib/videoFrameSampler.test.ts
import { describe, it, expect } from 'vitest'
import { computeSampleTimestamps } from './videoFrameSampler'

describe('computeSampleTimestamps', () => {
  it('evenly spaces N timestamps strictly inside the duration', () => {
    expect(computeSampleTimestamps(10, 4)).toEqual([2, 4, 6, 8])
  })

  it('returns a single midpoint timestamp when only 1 frame fits', () => {
    expect(computeSampleTimestamps(10, 1)).toEqual([5])
  })

  it('never returns a timestamp at or beyond the duration', () => {
    const timestamps = computeSampleTimestamps(9, 3)
    for (const t of timestamps) {
      expect(t).toBeGreaterThan(0)
      expect(t).toBeLessThan(9)
    }
  })

  it('returns an empty array for a non-positive duration', () => {
    expect(computeSampleTimestamps(0, 5)).toEqual([])
    expect(computeSampleTimestamps(-1, 5)).toEqual([])
  })

  it('returns an empty array for a non-positive frame count', () => {
    expect(computeSampleTimestamps(10, 0)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/lib/videoFrameSampler.test.ts`
Expected: FAIL — `videoFrameSampler.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/lib/videoFrameSampler.ts
import { computeResizedDimensions, type CompressedImage } from './imageResize'

export function computeSampleTimestamps(durationSeconds: number, frameCount: number): number[] {
  if (durationSeconds <= 0 || frameCount <= 0) return []
  const count = Math.max(1, Math.floor(frameCount))
  const step = durationSeconds / (count + 1)
  return Array.from({ length: count }, (_, i) => step * (i + 1))
}

// Samples up to `frameCount` evenly-spaced frames from a video file entirely
// client-side (no ffmpeg or server-side video processing available in the
// Supabase edge function this app uses). Reuses the same resize/compression
// bounds as photo uploads so a video contributes the same per-frame cost to
// the vision LLM call as an equivalent photo would.
export async function sampleVideoFrames(
  file: File,
  frameCount: number,
  maxDimension = 1500,
  quality = 0.8,
): Promise<CompressedImage[]> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.src = objectUrl
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('Failed to load video'))
    })
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error('Video has no readable duration')
    }

    const { width, height } = computeResizedDimensions(video.videoWidth, video.videoHeight, maxDimension)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not supported in this browser')

    const frames: CompressedImage[] = []
    for (const timestamp of computeSampleTimestamps(video.duration, frameCount)) {
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve()
        video.onerror = () => reject(new Error('Failed to seek video'))
        video.currentTime = timestamp
      })
      ctx.drawImage(video, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      frames.push({ mediaType: 'image/jpeg', data: dataUrl.split(',')[1] })
    }
    return frames
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/lib/videoFrameSampler.test.ts`
Expected: PASS (5 tests). `sampleVideoFrames` is intentionally not unit-tested here — it needs real `<video>`/`<canvas>` DOM behavior that jsdom doesn't implement; it's covered by Task 5's Playwright E2E test instead.

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/videoFrameSampler.ts src/app/lib/videoFrameSampler.test.ts
git commit -m "feat: add client-side video frame sampling for reel import"
```

---

### Task 3: Wire video upload into `ImportPage.tsx`

**Files:**
- Modify: `src/app/pages/ImportPage.tsx`
- Modify: `src/app/lib/types.ts`
- Modify: `src/app/lib/recipesApi.ts`
- Modify: `src/app/lib/i18n/translations.ts`

**Interfaces:**
- Consumes: `sampleVideoFrames` from Task 2's `src/app/lib/videoFrameSampler.ts`.
- Produces: `ImportPage.tsx`'s local `SourceType` type and `StagedPhoto` interface both gain a `'video'`/`source` distinction that Task 8 also touches (adding the Meta-URL error branch to the same `runImport` function this task modifies).

- [ ] **Step 1: Widen the `sourceType` unions**

In `src/app/lib/types.ts`, find the `Recipe` interface's `sourceType` field:

```ts
  sourceType: 'web' | 'youtube' | 'photo' | 'text'
```

Replace with:

```ts
  sourceType: 'web' | 'youtube' | 'photo' | 'text' | 'video' | 'instagram' | 'facebook'
```

In `src/app/lib/recipesApi.ts`, find `SaveRecipeInput`'s `sourceType` field:

```ts
  sourceType: 'web' | 'youtube' | 'photo' | 'text'
```

Replace with:

```ts
  sourceType: 'web' | 'youtube' | 'photo' | 'text' | 'video' | 'instagram' | 'facebook'
```

- [ ] **Step 2: Add the new translation key**

In `src/app/lib/i18n/translations.ts`, in the `en` object, immediately after the `'import.photoProcessingError'` line, add:

```ts
  'import.videoProcessingError': 'Failed to process the selected video.',
```

In the `it` object, immediately after its `'import.photoProcessingError'` line, add:

```ts
  'import.videoProcessingError': 'Impossibile elaborare il video selezionato.',
```

In the `fr` object, immediately after its `'import.photoProcessingError'` line, add:

```ts
  'import.videoProcessingError': "Le traitement de la vidéo sélectionnée a échoué.",
```

- [ ] **Step 3: Wire video files into the Photos tab**

In `src/app/pages/ImportPage.tsx`:

Add the import:

```ts
import { sampleVideoFrames } from '../lib/videoFrameSampler'
```

Change the local `SourceType` type:

```ts
type SourceType = 'web' | 'youtube' | 'photo' | 'text' | 'video' | 'instagram' | 'facebook'
```

Change the `StagedPhoto` interface:

```ts
interface StagedPhoto {
  previewUrl: string
  compressed: CompressedImage
  source: 'photo' | 'video'
}
```

Replace the whole `handlePhotosSelected` function with:

```ts
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
          newPhotos.push({ previewUrl, compressed: await compressImageFile(file), source: 'photo' })
        } catch {
          abort(t('import.photoProcessingError'))
          return
        }
      }
    }
    setPhotos((current) => [...current, ...newPhotos])
    setIsCompressing(false)
  }
```

(This also fixes a pre-existing bug in this function: the old code did `setPhotosError(err instanceof Error ? err.message : t('import.photoProcessingError'))`, which showed raw untranslated error text whenever `err` was an `Error` instance — the same class of bug fixed elsewhere this session. The new version always uses a translated key.)

Replace `handleRemovePhoto` with:

```ts
  function handleRemovePhoto(index: number) {
    setPhotos((current) => {
      const removed = current[index]
      if (removed.previewUrl.startsWith('blob:')) URL.revokeObjectURL(removed.previewUrl)
      return current.filter((_, i) => i !== index)
    })
  }
```

Replace `handlePhotosSubmit` with:

```ts
  function handlePhotosSubmit(event: FormEvent) {
    event.preventDefault()
    const hasVideoFrame = photos.some((p) => p.source === 'video')
    runImport({ type: 'images', images: photos.map((p) => p.compressed) }, hasVideoFrame ? 'video' : undefined)
  }
```

Change the `runImport` signature and its success branch:

```ts
  async function runImport(body: ImportRequestBody, sourceTypeOverride?: SourceType) {
    setStatus('importing')
    const { data: sessionData } = await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('server/import', {
      body,
      headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    })
    if (error || !data?.draft) {
      const isRateLimited = error?.context?.status === 429
      setErrorMessage(isRateLimited ? t('import.rateLimitError') : t('import.genericImportError'))
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
```

Finally, change the file input's `accept` attribute from `accept="image/*"` to `accept="image/*,video/*"`.

- [ ] **Step 4: Type-check and run the full frontend test suite**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all existing tests still pass (this task changes behavior but adds no new unit tests of its own — Task 5's E2E test covers the new UI path).

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/ImportPage.tsx src/app/lib/types.ts src/app/lib/recipesApi.ts src/app/lib/i18n/translations.ts
git commit -m "feat: accept video uploads in the Photos import tab, sampling frames client-side"
```

---

### Task 4: Generate an E2E fixture video

**Files:**
- Create: `e2e/fixtures/generate-recipe-reel.mjs`
- Create: `e2e/fixtures/recipe-reel.webm` (generated binary, committed like `e2e/fixtures/recipe-photo.png`)

**Interfaces:**
- Produces: `e2e/fixtures/recipe-reel.webm`, a short (~3s) browser-playable video file. Task 5's E2E test uploads this fixture.

There's no ffmpeg (or any video-processing binary) available in this environment. Instead, this script uses Playwright's bundled Chromium itself to *record* a tiny canvas animation via `MediaRecorder`, producing a real, browser-playable `.webm` file with no external tooling. This is a one-time generation script, not app code — it doesn't need a unit test.

- [ ] **Step 1: Write the generator script**

```js
// e2e/fixtures/generate-recipe-reel.mjs
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const html = `
<!doctype html>
<canvas id="c" width="320" height="240"></canvas>
<script>
  function uint8ToBase64(bytes) {
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
  }

  window.record = async () => {
    const canvas = document.getElementById('c')
    const ctx = canvas.getContext('2d')
    const stream = canvas.captureStream(10)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
    const chunks = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    const stopped = new Promise((resolve) => { recorder.onstop = resolve })
    recorder.start()
    const colors = ['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f']
    for (let i = 0; i < colors.length; i++) {
      ctx.fillStyle = colors[i]
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#ffffff'
      ctx.font = '32px sans-serif'
      ctx.fillText('Step ' + (i + 1), 40, 120)
      await new Promise((r) => setTimeout(r, 750))
    }
    recorder.stop()
    await stopped
    const blob = new Blob(chunks, { type: 'video/webm' })
    const buffer = await blob.arrayBuffer()
    return uint8ToBase64(new Uint8Array(buffer))
  }
</script>
`

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(html)
const base64 = await page.evaluate(() => window.record())
const outPath = path.join(__dirname, 'recipe-reel.webm')
writeFileSync(outPath, Buffer.from(base64, 'base64'))
await browser.close()
console.log(`Wrote ${outPath}`)
```

- [ ] **Step 2: Run it and verify the fixture was created**

Run: `node e2e/fixtures/generate-recipe-reel.mjs`
Expected: prints `Wrote .../e2e/fixtures/recipe-reel.webm`; the file exists and is a few KB (a 3-second, 320x240, 10fps solid-color canvas recording is small).

Run: `node -e "const fs=require('fs'); const s=fs.statSync('e2e/fixtures/recipe-reel.webm'); if (s.size < 500) throw new Error('fixture is suspiciously small: ' + s.size + ' bytes'); console.log('OK, size:', s.size)"`
Expected: prints `OK, size: <N>` with N in the low thousands.

- [ ] **Step 3: Commit**

```bash
git add e2e/fixtures/generate-recipe-reel.mjs e2e/fixtures/recipe-reel.webm
git commit -m "test: add a generated fixture video for reel-upload E2E coverage"
```

---

### Task 5: E2E test for video upload

**Files:**
- Create: `e2e/import-video.spec.ts`

**Interfaces:**
- Consumes: `e2e/fixtures/recipe-reel.webm` (Task 4), the video-upload UI from Task 3, `signInAsNewUser` from `e2e/helpers/auth.ts` (existing).

This is an acceptance/verification test, not TDD in the red-green sense — the feature it exercises was already implemented and unit-tested in Tasks 2-3. It mirrors `e2e/import-photo.spec.ts`'s structure.

- [ ] **Step 1: Write the E2E spec**

```ts
// e2e/import-video.spec.ts
import path from 'path'
import { fileURLToPath } from 'url'
import { test, expect } from '@playwright/test'
import { signInAsNewUser } from './helpers/auth'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('upload a recipe reel video, sample frames, review, and save it', async ({ page }) => {
  const { cleanup } = await signInAsNewUser(page)
  try {
    await page.goto('/import')
    await page.getByRole('tab', { name: 'Take Photos' }).click()
    await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, 'fixtures', 'recipe-reel.webm'))

    // The fixture is a ~3s video; computeSampleTimestamps produces up to
    // MAX_PHOTOS (5) evenly-spaced frames when there's no other photo staged.
    await expect(page.getByRole('button', { name: /^Remove photo/ })).toHaveCount(5)
    await page.screenshot({ path: 'screenshot/import-video-staged.png' })

    await page.getByRole('button', { name: 'Extract recipe from photos' }).click()

    // Hits the real vision LLM extraction call, same as the photo import test.
    await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: 'screenshot/import-video-review.png' })

    await page.getByLabel('Title').fill('Reel Soup')
    await page.getByLabel('Ingredients (one per line)').fill('1 can tomatoes')
    await page.getByLabel('Steps (one per line)').fill('Stir.\nServe.')
    await page.getByRole('button', { name: 'Save recipe' }).click()

    await expect(page).toHaveURL(/\/recipe\/[\w-]+$/)
    await expect(page.getByRole('heading', { name: 'Reel Soup' })).toBeVisible()
    await page.screenshot({ path: 'screenshot/import-video-detail.png' })
  } finally {
    await cleanup()
  }
})
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/import-video.spec.ts`
Expected: PASS. If the frame count assertion fails, check that `MAX_PHOTOS` in `ImportPage.tsx` is still `5` and that the fixture video's duration wasn't changed in Task 4.

- [ ] **Step 3: Commit**

```bash
git add e2e/import-video.spec.ts
git commit -m "test: add E2E coverage for uploading a recipe reel video"
```

---

## Phase 1 Acceptance Criteria

- [ ] `npx vitest run` passes, including the new `videoFrameSampler.test.ts`.
- [ ] `npx playwright test e2e/import-video.spec.ts` passes, with screenshots saved under `./screenshot/`.
- [ ] Uploading a video in the "Take Photos" tab stages sampled frames exactly like camera photos (same remove button, same `MAX_PHOTOS` cap shared across photos+video frames).
- [ ] A recipe imported from a video-only upload is saved with `sourceType: 'video'`; a photo-only upload still saves as `'photo'` (unchanged).
- [ ] No file under `supabase/functions/server/**` changed in this phase.

## Phase 1 Edge Cases

- **Corrupt/unreadable video file.** `sampleVideoFrames` throws before producing any frames (either `loadedmetadata` never fires productively, or `duration` is non-finite/zero) → `import.videoProcessingError` is shown, no partial frames are staged.
- **User mixes photos and a video in one file-picker selection.** Handled file-by-file in `handlePhotosSelected`'s loop; each respects the shared, shrinking `remainingCapacity`.
- **Video longer than the Reel-length cap either platform enforces (~90s).** Not specifically guarded — `computeSampleTimestamps` just spaces frames across whatever `duration` the browser reports; an unusually long file only affects which moments get sampled, not correctness.

---

## Phase 2: URL/caption path via Meta oEmbed

### Task 6: `metaOembed.ts` — URL detection and caption fetch

**Files:**
- Create: `supabase/functions/server/extraction/metaOembed.ts`
- Test: `supabase/functions/server/extraction/metaOembed.test.ts`

**Interfaces:**
- Produces: `detectMetaUrl(url: string): { platform: "instagram" | "facebook" } | null` and `fetchMetaCaption(url: string, platform: "instagram" | "facebook", accessToken: string, fetchFn: typeof fetch): Promise<string>`. Task 7 imports both into `routes/import.ts` / wires the latter through `ImportAppDeps`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/server/extraction/metaOembed.test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectMetaUrl, fetchMetaCaption } from "./metaOembed.ts";

function fakeFetch(status: number, body: unknown): { fetchFn: typeof fetch; getLastUrl: () => string } {
  let lastUrl = "";
  const fetchFn = (async (url: string) => {
    lastUrl = url;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchFn, getLastUrl: () => lastUrl };
}

Deno.test("detects Instagram URLs", () => {
  assertEquals(detectMetaUrl("https://www.instagram.com/reel/abc123/"), { platform: "instagram" });
  assertEquals(detectMetaUrl("https://instagram.com/p/abc123/"), { platform: "instagram" });
});

Deno.test("detects Facebook URLs, including fb.watch short links", () => {
  assertEquals(detectMetaUrl("https://www.facebook.com/reel/123456"), { platform: "facebook" });
  assertEquals(detectMetaUrl("https://fb.watch/abc123/"), { platform: "facebook" });
});

Deno.test("returns null for unrelated URLs", () => {
  assertEquals(detectMetaUrl("https://example.com/recipe"), null);
  assertEquals(detectMetaUrl("https://youtu.be/abcdefghijk"), null);
});

Deno.test("extracts the caption from a successful oEmbed response", async () => {
  const { fetchFn } = fakeFetch(200, { title: "1kg flour, 500ml water. Mix and bake." });
  const caption = await fetchMetaCaption("https://www.instagram.com/reel/abc123/", "instagram", "token", fetchFn);
  assertEquals(caption, "1kg flour, 500ml water. Mix and bake.");
});

Deno.test("requests the Instagram oEmbed endpoint with the url and access token", async () => {
  const { fetchFn, getLastUrl } = fakeFetch(200, { title: "Recipe text" });
  await fetchMetaCaption("https://www.instagram.com/reel/abc123/", "instagram", "app-id|client-token", fetchFn);
  const url = getLastUrl();
  assertEquals(url.includes("graph.facebook.com/v19.0/instagram_oembed"), true);
  assertEquals(url.includes("access_token=app-id%7Cclient-token"), true);
});

Deno.test("requests the Facebook oEmbed endpoint for Facebook URLs", async () => {
  const { fetchFn, getLastUrl } = fakeFetch(200, { title: "Recipe text" });
  await fetchMetaCaption("https://www.facebook.com/reel/123456", "facebook", "token", fetchFn);
  assertEquals(getLastUrl().includes("graph.facebook.com/v19.0/oembed_video"), true);
});

Deno.test("throws when the oEmbed request itself fails", async () => {
  const { fetchFn } = fakeFetch(400, { error: { message: "Invalid access token" } });
  await assertRejects(
    () => fetchMetaCaption("https://www.instagram.com/reel/abc123/", "instagram", "bad-token", fetchFn),
    Error,
    "Meta oEmbed request failed",
  );
});

Deno.test("throws when the response has no caption", async () => {
  const { fetchFn } = fakeFetch(200, { title: "" });
  await assertRejects(
    () => fetchMetaCaption("https://www.instagram.com/reel/abc123/", "instagram", "token", fetchFn),
    Error,
    "Post has no caption",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/server/extraction/metaOembed.test.ts`
Expected: FAIL — `metaOembed.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// supabase/functions/server/extraction/metaOembed.ts
export function detectMetaUrl(url: string): { platform: "instagram" | "facebook" } | null {
  if (/^https?:\/\/(www\.)?instagram\.com\//i.test(url)) return { platform: "instagram" };
  if (/^https?:\/\/(www\.)?(facebook\.com|fb\.watch)\//i.test(url)) return { platform: "facebook" };
  return null;
}

// Meta's Graph oEmbed API is the only official, ToS-compliant hook into a
// public Instagram/Facebook post from a server - it returns caption/embed
// metadata, never the video file itself. Requires a registered Meta
// developer app; Meta has historically required App Review for some oEmbed
// scopes in production, which is outside this codebase's control - a
// failure here (private post, unapproved app, no caption) is expected to
// happen sometimes, and the caller falls back to the manual upload path.
export async function fetchMetaCaption(
  url: string,
  platform: "instagram" | "facebook",
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const endpoint = platform === "instagram"
    ? "https://graph.facebook.com/v19.0/instagram_oembed"
    : "https://graph.facebook.com/v19.0/oembed_video";
  const requestUrl = `${endpoint}?url=${encodeURIComponent(url)}&access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetchFn(requestUrl);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Meta oEmbed request failed: ${response.status} ${body}`);
  }
  const data = await response.json();
  const caption = data?.title;
  if (typeof caption !== "string" || caption.trim().length === 0) {
    throw new Error("Post has no caption to extract a recipe from");
  }
  return caption;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/server/extraction/metaOembed.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/server/extraction/metaOembed.ts supabase/functions/server/extraction/metaOembed.test.ts
git commit -m "feat: add Meta oEmbed URL detection and caption fetching"
```

---

### Task 7: Wire the Meta branch into the import route

**Files:**
- Modify: `supabase/functions/server/routes/import.ts`
- Modify: `supabase/functions/server/routes/import.test.ts`
- Modify: `supabase/functions/server/index.ts`

**Interfaces:**
- Consumes: `detectMetaUrl`, `fetchMetaCaption` from Task 6's `extraction/metaOembed.ts`.
- Produces: `ImportAppDeps` gains a required `fetchMetaCaption: (url: string, platform: "instagram" | "facebook") => Promise<string>` field. Every other file that constructs `ImportAppDeps` (only `import.test.ts` and `index.ts`, both touched in this task) must supply it.

- [ ] **Step 1: Add the new required dep to every existing test fixture**

In `supabase/functions/server/routes/import.test.ts`, every existing `buildImportApp({...})` call includes the line `fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),`. Using a find-and-replace across the whole file, insert a new line directly after every occurrence of that line:

```ts
    fetchMetaCaption: async () => "",
```

(Every existing test in this file is unrelated to the Meta branch — the stub just needs to satisfy the now-required interface field so the file still compiles.)

- [ ] **Step 2: Write the new failing tests**

Append to `supabase/functions/server/routes/import.test.ts`:

```ts
Deno.test("routes Instagram URLs through the Meta caption path", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async (_url, platform) => {
      assertEquals(platform, "instagram");
      return "1kg flour, 500ml water. Mix and bake.";
    },
    llmClientFactory: () =>
      fakeLlmClient({ title: "Reel Bread", complexity: null, servings: null, ingredients: [], steps: [] }),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "url", url: "https://www.instagram.com/reel/abc123/" }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.sourceType, "instagram");
  assertEquals(body.draft.title, "Reel Bread");
});

Deno.test("routes Facebook URLs through the Meta caption path", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async (_url, platform) => {
      assertEquals(platform, "facebook");
      return "Chop onions. Simmer for ten minutes.";
    },
    llmClientFactory: () =>
      fakeLlmClient({ title: "Reel Soup", complexity: null, servings: null, ingredients: [], steps: [] }),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "url", url: "https://www.facebook.com/reel/123456" }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.sourceType, "facebook");
  assertEquals(body.draft.title, "Reel Soup");
});

Deno.test("falls back to the generic error path when Meta caption fetching fails", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => {
      throw new Error("Post has no caption to extract a recipe from");
    },
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "url", url: "https://www.instagram.com/reel/abc123/" }),
  });
  assertEquals(response.status, 502);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `deno test supabase/functions/server/routes/import.test.ts`
Expected: FAIL — `buildImportApp` doesn't accept `fetchMetaCaption` yet, and Instagram/Facebook URLs currently fall through to the plain web-fetch branch.

- [ ] **Step 4: Implement the route change**

In `supabase/functions/server/routes/import.ts`, add the import:

```ts
import { detectMetaUrl } from "../extraction/metaOembed.ts";
```

Add to `ImportAppDeps`:

```ts
  fetchMetaCaption: (url: string, platform: "instagram" | "facebook") => Promise<string>;
```

Change the `sourceType` local variable's type from:

```ts
      let sourceType: "web" | "youtube" | "text" | "photo";
```

to:

```ts
      let sourceType: "web" | "youtube" | "text" | "photo" | "instagram" | "facebook";
```

Replace the `type === "url"` branch's body with:

```ts
      } else if (type === "url") {
        if (typeof rawBody.url !== "string") return c.json({ error: "Missing url" }, 400);
        const url = rawBody.url;
        const videoId = extractYoutubeVideoId(url);
        const metaMatch = videoId ? null : detectMetaUrl(url);
        sourceType = videoId ? "youtube" : metaMatch ? metaMatch.platform : "web";

        if (videoId) {
          let sourceText: string;
          try {
            sourceText = await deps.fetchYoutubeTranscript(videoId);
          } catch {
            const info = await deps.fetchYoutubeVideoInfo(videoId);
            sourceText = `${info.title}\n\n${info.description}`;
          }
          draft = await extractRecipeWithLlm(sourceText, deps.llmClientFactory());
        } else if (metaMatch) {
          const caption = await deps.fetchMetaCaption(url, metaMatch.platform);
          draft = await extractRecipeWithLlm(caption, deps.llmClientFactory());
        } else {
          const pageResponse = await fetch(url);
          if (!pageResponse.ok) throw new Error(`Failed to fetch page: ${pageResponse.status}`);
          const html = await pageResponse.text();
          const jsonLd = findRecipeJsonLd(html);
          const jsonLdDraft = jsonLd ? jsonLdToDraft(jsonLd) : null;
          const llmDraft = await extractRecipeWithLlm(htmlToVisibleText(html), deps.llmClientFactory());
          draft = mergeDrafts(jsonLdDraft, llmDraft);
        }
      } else {
```

(Everything else in the route is unchanged — the failure from `fetchMetaCaption` throwing propagates to the route's existing outer `catch`, returning the existing generic 502 shape.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test supabase/functions/server/routes/import.test.ts`
Expected: PASS (every prior test plus the 3 new ones — check the full count against the file).

- [ ] **Step 6: Wire real secrets in `index.ts`**

In `supabase/functions/server/index.ts`, add the import:

```ts
import { fetchMetaCaption } from "./extraction/metaOembed.ts";
```

Add alongside the other `Deno.env.get` lines:

```ts
const metaAppId = Deno.env.get("META_APP_ID")!;
const metaClientToken = Deno.env.get("META_CLIENT_TOKEN")!;
```

Add to the `buildImportApp({...})` deps object:

```ts
    fetchMetaCaption: (url, platform) => fetchMetaCaption(url, platform, `${metaAppId}|${metaClientToken}`, fetch),
```

- [ ] **Step 7: Set the Meta oEmbed secrets** *(manual step — requires a Meta developer account, outside this plan's scope)*

Run: `supabase secrets set META_APP_ID=<your Meta app id> META_CLIENT_TOKEN=<your Meta app's client token>`
Expected: confirmation output; the values are available to the edge function as `Deno.env.get("META_APP_ID")`/`Deno.env.get("META_CLIENT_TOKEN")` on next deploy/restart. Until this is done, Instagram/Facebook URL imports will still route through this new branch but always fail Meta's auth check — which is the same graceful-failure behavior Task 9's test verifies, so this can be done later without blocking anything in this plan.

- [ ] **Step 8: Deploy the updated edge function**

Run: `supabase functions deploy server`
Expected: deploy succeeds. Task 9's E2E test needs this deployed before it can observe the new branch's behavior — until then, the currently-deployed function doesn't know about Instagram/Facebook URLs at all and would fall through to the old plain-web-fetch branch instead.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/server/routes/import.ts supabase/functions/server/routes/import.test.ts supabase/functions/server/index.ts
git commit -m "feat: route Instagram/Facebook URLs through Meta oEmbed caption extraction"
```

---

### Task 8: Client-side fallback nudge + URL placeholder copy

**Files:**
- Create: `src/app/lib/metaUrl.ts`
- Test: `src/app/lib/metaUrl.test.ts`
- Modify: `src/app/pages/ImportPage.tsx`
- Modify: `src/app/lib/i18n/translations.ts`
- Modify: `e2e/import-and-cook.spec.ts`

**Interfaces:**
- Produces: `isInstagramOrFacebookUrl(url: string): boolean`. `ImportPage.tsx`'s `runImport` (already modified in Task 3) consumes it to choose which translated error message to show.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/lib/metaUrl.test.ts
import { describe, it, expect } from 'vitest'
import { isInstagramOrFacebookUrl } from './metaUrl'

describe('isInstagramOrFacebookUrl', () => {
  it('matches Instagram links', () => {
    expect(isInstagramOrFacebookUrl('https://www.instagram.com/reel/abc123/')).toBe(true)
    expect(isInstagramOrFacebookUrl('https://instagram.com/p/abc123/')).toBe(true)
  })

  it('matches Facebook links, including fb.watch short links', () => {
    expect(isInstagramOrFacebookUrl('https://www.facebook.com/reel/123456')).toBe(true)
    expect(isInstagramOrFacebookUrl('https://fb.watch/abc123/')).toBe(true)
  })

  it('does not match unrelated URLs', () => {
    expect(isInstagramOrFacebookUrl('https://example.com/recipe')).toBe(false)
    expect(isInstagramOrFacebookUrl('https://youtu.be/abcdefghijk')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/lib/metaUrl.test.ts`
Expected: FAIL — `metaUrl.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/lib/metaUrl.ts
export function isInstagramOrFacebookUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(instagram\.com|facebook\.com|fb\.watch)\//i.test(url)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/lib/metaUrl.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add translation keys**

In `src/app/lib/i18n/translations.ts`, in the `en` object, immediately after the `'import.rateLimitError'` line, add:

```ts
  'import.metaImportError': "Couldn't get a recipe from that link — try uploading the video or a few screenshots instead.",
```

Change the `en` object's `'import.urlPlaceholder'` line from:

```ts
  'import.urlPlaceholder': 'https://example.com/recipe or a YouTube URL',
```

to:

```ts
  'import.urlPlaceholder': 'https://example.com/recipe, a YouTube URL, or an Instagram/Facebook Reel link',
```

In the `it` object, immediately after its `'import.rateLimitError'` line, add:

```ts
  'import.metaImportError': 'Impossibile ottenere una ricetta da questo link: prova invece a caricare il video o alcuni screenshot.',
```

Change the `it` object's `'import.urlPlaceholder'` line from:

```ts
  'import.urlPlaceholder': 'https://esempio.com/ricetta oppure un URL YouTube',
```

to:

```ts
  'import.urlPlaceholder': 'https://esempio.com/ricetta, un URL YouTube o un link a un Reel di Instagram/Facebook',
```

In the `fr` object, immediately after its `'import.rateLimitError'` line, add:

```ts
  'import.metaImportError': "Impossible d'obtenir une recette à partir de ce lien : essayez plutôt de charger la vidéo ou quelques captures d'écran.",
```

Change the `fr` object's `'import.urlPlaceholder'` line from:

```ts
  'import.urlPlaceholder': 'https://exemple.com/recette ou une URL YouTube',
```

to:

```ts
  'import.urlPlaceholder': 'https://exemple.com/recette, une URL YouTube ou un lien vers un Reel Instagram/Facebook',
```

- [ ] **Step 6: Wire the nudge message into `runImport`**

In `src/app/pages/ImportPage.tsx`, add the import:

```ts
import { isInstagramOrFacebookUrl } from '../lib/metaUrl'
```

In `runImport` (as left by Task 3), change:

```ts
    if (error || !data?.draft) {
      const isRateLimited = error?.context?.status === 429
      setErrorMessage(isRateLimited ? t('import.rateLimitError') : t('import.genericImportError'))
```

to:

```ts
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
```

- [ ] **Step 7: Fix the existing E2E test that asserts the old placeholder text**

In `e2e/import-and-cook.spec.ts`, change:

```ts
      .getByPlaceholder('https://example.com/recipe or a YouTube URL')
```

to:

```ts
      .getByPlaceholder('https://example.com/recipe, a YouTube URL, or an Instagram/Facebook Reel link')
```

- [ ] **Step 8: Verify everything still builds and passes**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass, including the translations parity test (`translations.test.ts`) picking up the new keys in all three languages.

- [ ] **Step 9: Commit**

```bash
git add src/app/lib/metaUrl.ts src/app/lib/metaUrl.test.ts src/app/pages/ImportPage.tsx src/app/lib/i18n/translations.ts e2e/import-and-cook.spec.ts
git commit -m "feat: show a fallback nudge when an Instagram/Facebook URL import fails"
```

---

### Task 9: E2E test for the Meta URL fallback message

**Files:**
- Create: `e2e/import-meta-url.spec.ts`

**Interfaces:**
- Consumes: the updated `runImport` error branch from Task 8, `signInAsNewUser` from `e2e/helpers/auth.ts`.

This test only verifies the deployment-independent, deterministic part of Phase 2 (see Global Constraints). It requires Task 7's Steps 7-8 (secrets + deploy) to have run first — otherwise the currently-deployed function doesn't recognize Instagram/Facebook URLs yet and this assertion won't hold.

- [ ] **Step 1: Write the E2E spec**

```ts
// e2e/import-meta-url.spec.ts
import { test, expect } from '@playwright/test'
import { signInAsNewUser } from './helpers/auth'

test('pasting an Instagram Reel link that fails shows the upload-fallback message, not the generic one', async ({ page }) => {
  const { cleanup } = await signInAsNewUser(page)
  try {
    await page.goto('/import')
    await page
      .getByPlaceholder('https://example.com/recipe, a YouTube URL, or an Instagram/Facebook Reel link')
      .fill('https://www.instagram.com/reel/nonexistent-fixture-post/')
    await page.getByRole('button', { name: 'Import' }).click()

    // No real Meta app credentials are guaranteed to be configured against
    // this environment, so this call is expected to fail - the point of
    // this test is confirming the failure surfaces the Instagram/Facebook
    // specific nudge (pointing at the upload fallback), not the generic
    // import error message.
    await expect(page.getByText("Couldn't get a recipe from that link")).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: 'screenshot/import-meta-url-error.png' })
  } finally {
    await cleanup()
  }
})
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/import-meta-url.spec.ts`
Expected: PASS, once Task 7's Steps 7-8 have been completed against the hosted project. If it fails with the generic error message instead, the deployed edge function most likely doesn't have Task 7's changes yet — re-run `supabase functions deploy server`.

- [ ] **Step 3: Commit**

```bash
git add e2e/import-meta-url.spec.ts
git commit -m "test: add E2E coverage for the Instagram/Facebook URL fallback message"
```

---

## Phase 2 Acceptance Criteria

- [ ] `deno test supabase/functions/server` passes, including the new `metaOembed.test.ts` and the 3 new `import.test.ts` cases.
- [ ] `npx vitest run` passes, including the new `metaUrl.test.ts` and the updated `translations.test.ts` parity check.
- [ ] Pasting an Instagram or Facebook URL routes through the Meta caption branch (`sourceType: 'instagram' | 'facebook'`), never the plain web-fetch branch.
- [ ] A failed Meta caption fetch shows the fallback nudge message pointing at the upload path, not the generic import error.
- [ ] `npx playwright test e2e/import-meta-url.spec.ts` passes with a screenshot saved under `./screenshot/`.

## Phase 2 Edge Cases

- **Meta app not yet configured (`META_APP_ID`/`META_CLIENT_TOKEN` unset).** `Deno.env.get(...)!` doesn't throw at runtime for a missing var (the `!` is compile-time only) — `metaAppId`/`metaClientToken` are simply `undefined`, producing a literal `"undefined|undefined"` access token. The real request to Meta's Graph API still goes out and fails on auth, surfacing as the same 502 → fallback-nudge path this phase already handles. The edge function itself never crashes or blocks YouTube/web imports.
- **Meta's oEmbed API requires App Review for production traffic.** Acknowledged as an open external risk in the design spec — if it turns out oEmbed access is unavailable even with valid credentials, this phase degrades to always showing the fallback nudge, and the manual-upload path (Phase 1) remains fully functional on its own.
- **A caption exists but is unrelated to a recipe (e.g. just hashtags).** Not specially handled — it flows into the existing `extractRecipeWithLlm` call exactly like a YouTube description with no recipe in it would; the LLM returns as complete a draft as it can, same as today's behavior for thin YouTube fallback text.
- **Reverting this phase.** The new branch is additive (an `else if` inside the existing `url` handling) and gated by `detectMetaUrl` matching — removing the `metaMatch` check and its branch, plus the `ImportAppDeps.fetchMetaCaption` field, fully reverts backend behavior to pre-Phase-2. Frontend revert is likewise just Task 8's diff in reverse.
