# Instagram/Facebook Reel Import — Design Spec

Date: 2026-09-01
Status: Approved for planning

## 1. Objective

Extend Ricettario's recipe import to cover Instagram and Facebook Reels, which [the original design](2026-08-28-ricettario-design.md) explicitly deferred ("no official transcript API exists for either platform, and reliable extraction would require fragile scraping or audio transcription").

Two independent import paths are added, both terminating in the existing review/edit-draft screen. Neither path touches the review/save flow, the data model beyond `source_type`, or the rate limiter's logic.

## 2. Scope for this iteration

- **Manual upload path**: the user supplies the reel's video (already saved/screen-recorded on their own device) or a handful of screenshots; the browser samples frames from any video client-side and reuses the existing photo-extraction pipeline unchanged.
- **URL/caption path**: the user pastes an Instagram or Facebook Reel URL; the backend fetches the post's caption text via Meta's official oEmbed API and runs it through the existing text-extraction pipeline (same shape as the YouTube description fallback).
- **Out of scope for this iteration**: audio transcription of the reel's spoken narration (frames + caption text only); any approach that fetches the actual video file from a pasted URL (no ToS-compliant API exists for third-party public Reels — see §3).

## 3. Constraints & priorities

- **No scraping of Instagram/Facebook.** Meta's Graph API only grants programmatic access to content the calling app/account owns or manages — there is no equivalent to the YouTube Data API for reading arbitrary third-party public posts' video files. Fetching raw video bytes from a pasted URL without login would require reverse-engineering private endpoints, which is a ToS violation and out of bounds for this project.
- **Meta's oEmbed API is the one legitimate server-side hook available**, and only for caption/embed metadata — not the video itself. It requires a registered Meta developer app (`META_APP_ID` + `META_CLIENT_TOKEN`) and, per Meta's historical policy, may need App Review for production traffic. This is a real, unresolved risk: **the URL/caption path may turn out to be unavailable or rate-limited in practice**, which is exactly why it's built second, on top of a manual-upload path that has no external dependency at all.
- **Frame sampling happens entirely client-side.** Supabase's Deno Edge Functions have no ffmpeg or comparable video-processing binary available; browsers already support frame extraction natively via `<video>` + `<canvas>`. This also means the manual-upload path requires **zero backend changes** — it produces the same `images` payload the photo-import path already sends.
- **Cost-consciousness** (carried over from the original spec): both paths reuse the existing per-user daily import rate limit unchanged; the URL/caption path is a single cheap text LLM call (same cost profile as the YouTube description fallback); the upload path's cost is bounded by capping the number of sampled frames.

## 4. Architecture overview

```
Manual upload (no backend changes):
┌──────────────────────────┐
│ ImportPage "Take Photos" │  accept video files too
│ + videoFrameSampler.ts   │  <video>+<canvas>, ~8 evenly-spaced frames,
│ (client-side)            │  reuses existing compressImageFile pipeline
└────────────┬──────────────┘
             │ POST /server/import { type: "images", images: [...] }
             ▼
   (existing llmExtractImages.ts pipeline — unchanged)

URL/caption:
┌──────────────────────────┐
│ ImportPage "From URL"    │  paste an Instagram/Facebook Reel link
└────────────┬──────────────┘
             │ POST /server/import { type: "url", url }
             ▼
┌──────────────────────────┐
│ routes/import.ts          │  detect Instagram/Facebook URL
│ extraction/metaOembed.ts  │  → Meta Graph oEmbed → caption text
└────────────┬──────────────┘
             │
             ▼
   (existing extractRecipeWithLlm — unchanged, same as YouTube fallback)
```

## 5. Data model changes

Extend the `source_type` check constraint (currently `'web' | 'youtube' | 'photo' | 'text'` per `0003_widen_import_source_types.sql`) with three new values:

```sql
-- 0005_widen_import_source_types_reels.sql
alter table recipes drop constraint if exists recipes_source_type_check;
alter table recipes add constraint recipes_source_type_check
  check (source_type in ('web', 'youtube', 'photo', 'text', 'video', 'instagram', 'facebook'));
```

- `'video'`: manual-upload recipes sourced from a video file (vs. `'photo'` for still images) — recorded for clarity only, no behavior differs from `'photo'`.
- `'instagram'` / `'facebook'`: URL/caption-path recipes, mirroring how `'youtube'` is distinct from `'web'`.

`RecipeDraft`/`Recipe` types' `sourceType` union (`src/app/lib/types.ts`) gains the same three values.

## 6. Extraction pipeline

### 6.1 Manual upload (frames + optional real photos)

1. User opens the "Take Photos" tab (input now accepts `image/*,video/*`) and either takes/uploads photos as today, or selects/uploads a video file of the reel.
2. New client-side module `videoFrameSampler.ts`: given a video file, loads it into an off-DOM `<video>` element, reads `duration`, computes N evenly-spaced timestamps (capped, e.g. 8), seeks to each, draws the current frame to a `<canvas>`, and extracts it as a compressed image blob — reusing the existing `compressImageFile`-style resize/compression logic.
3. Each extracted frame is pushed into the same `photos` staged array used for camera photos today; the user can still add/remove individual photos before extracting, exactly as now.
4. On "Extract", the request is `POST /server/import { type: "images", images: [...] }` — indistinguishable from today's photo import at the backend. `llmExtractImages.ts` is unmodified.
5. `sourceType` is set to `'video'` client-side when the staged set includes any video-derived frames (vs. `'photo'` for photo-only uploads).

No audio transcription in this iteration — recipes where quantities/steps are only spoken and never shown on screen or written in a caption won't extract cleanly. Revisit only if this proves to be a common failure in practice.

### 6.2 URL/caption path

1. User pastes an Instagram or Facebook Reel URL into the existing "From URL" tab. No UI change beyond updated placeholder copy.
2. `routes/import.ts`'s `type === "url"` branch, after the existing YouTube-ID check, adds an Instagram/Facebook URL-pattern check (post/reel ID extraction, analogous to `extractYoutubeVideoId`).
3. New `extraction/metaOembed.ts` (mirrors `youtubeDescription.ts`): calls Meta's Graph oEmbed endpoint (`instagram_oembed` / the Facebook video oEmbed equivalent) with an access token built from `META_APP_ID`/`META_CLIENT_TOKEN`, and extracts the caption text from the response.
4. The caption text is fed into the existing `extractRecipeWithLlm` — the exact same call shape as the YouTube title+description fallback. No new LLM prompt/schema work.
5. `sourceType` is set to `'instagram'` or `'facebook'` based on which platform matched.
6. New secrets `META_APP_ID`, `META_CLIENT_TOKEN` are read in `index.ts` and passed into `buildImportApp`'s deps, following the exact pattern `YOUTUBE_API_KEY`/`fetchYoutubeVideoInfo` already use.

This path is expected to work well for creators who write out the recipe in the caption, and to produce no useful draft for reels that only demonstrate the recipe visually/verbally — the manual-upload path is the fallback for those.

## 7. Error handling

- **oEmbed failure** (private/deleted post, malformed URL, Meta app not approved, Meta-side rate limiting, or a caption-less post) falls through to `import.ts`'s existing catch-all → the existing translated generic import error (`import.genericImportError`) is shown, consistent with the recent i18n fix ensuring these are never raw English server text.
- **New nudge message**: when the failure specifically comes from the Instagram/Facebook branch, show a translated message pointing at the fallback (new key, e.g. `import.metaImportError`: "Couldn't get a recipe from that link — try uploading the video or a few screenshots instead."), in all three languages (`en`/`it`/`fr`).
- **Client-side video errors** (corrupt file, unreadable codec, zero-duration video): new translated inline error state, following the exact pattern of the existing `photosError` state in `ImportPage.tsx`.
- **Soft duration/size guard** before sampling begins (reels are already capped at ~90s by both platforms, so this is a sanity check, not a real-world constraint) — reject with the same client-side error state rather than attempting to sample an unreasonably long file.

## 8. Testing strategy

**Unit tests (Vitest)**:
- `metaOembed.test.ts` mirroring `youtubeDescription.test.ts` — mocked `fetch`, covering successful caption extraction and each failure mode (private post, no caption, malformed response).
- `videoFrameSampler.ts`'s pure logic (timestamp computation given a duration and frame count) is factored out and unit-tested directly; the actual `<video>`/`<canvas>` drawing is not reliably testable under jsdom and is left thin.
- `import.test.ts` additions for the new Instagram/Facebook URL branch (mocked `metaOembed` + mocked LLM client, matching the existing YouTube branch's test structure).

**E2E tests (Playwright)**:
- New spec mirroring `e2e/import-photo.spec.ts`: upload a small fixture video through the "Take Photos" tab, assert frames get staged and an extraction request is sent.
- New spec for pasting an Instagram/Facebook URL with a mocked backend response, through to the review screen (mirrors `e2e/import-and-cook.spec.ts`'s URL-import coverage).

**Visual verification**: screenshot the updated "Take Photos" tab (with a staged video thumbnail/frame preview) and the URL tab's updated placeholder, per the existing screenshot-verification practice.

## 9. Build order

1. Manual-upload path first — no external API dependency, so it ships real Instagram/Facebook support regardless of what happens with Meta's oEmbed access.
2. URL/caption path second, as a bonus fast path once Meta app credentials are confirmed working end-to-end.

## 10. Explicitly deferred (not this iteration)

- Audio transcription of reel narration.
- Any form of automated video download from a pasted Instagram/Facebook URL.
- Frame count/quality tuning beyond a reasonable fixed default (~8 evenly-spaced frames).
