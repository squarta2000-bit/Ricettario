# TikTok Video Import — Design Spec

Date: 2026-09-05
Status: Approved for planning

## 1. Objective

Extend Ricettario's recipe import to cover TikTok videos, following the same "paste a link" pattern already available for web pages, YouTube, and Instagram/Facebook Reels.

This was investigated as a spike first, specifically to check whether it would hit the same wall as Instagram/Facebook did: Meta's oEmbed API requires App Review before it works on arbitrary public content, which was judged not worth pursuing for this app's personal/family-scale use. The spike result was different: TikTok's oEmbed endpoint (`https://www.tiktok.com/oembed`) is public and unauthenticated — no developer app, no access token, no review process. A live test against a real recipe video returned the full caption text (including a completely written-out ingredients/steps list) with a plain GET request and nothing more than a browser-like User-Agent header.

## 2. Scope for this iteration

- **URL/caption path only**: the user pastes a TikTok video URL into the existing "From URL" tab; the backend fetches the video's caption via TikTok's oEmbed endpoint and runs it through the existing text-extraction pipeline (same shape as the YouTube description fallback and the Instagram/Facebook caption path).
- **Manual upload already works for TikTok with zero changes**: a screen-recorded TikTok video can already be uploaded today via the "Take Photos" tab (which accepts video and frame-samples it client-side) — that path is platform-agnostic and untouched by this iteration, exactly as it already was for Instagram/Facebook.
- **Out of scope for this iteration**: any form of TikTok video download (no ToS-compliant API exists for fetching the actual video file from a pasted URL — same reasoning as Meta); TikTok's own captions/subtitles or any transcript of spoken narration (no public API for this); recipes that rely purely on spoken narration with no caption text (falls back to the manual upload path, same known gap YouTube/Meta already have).

## 3. Constraints & priorities

- **No access token, no developer app registration, no App Review** — this is the entire reason this iteration is worth building, in contrast to Instagram/Facebook. Do not add any credential handling that would suggest otherwise.
- **TikTok's WAF blocks some automated/bot-like traffic** — confirmed during the spike that a request without a browser-like `User-Agent` header can be blocked, while one with a standard browser UA string succeeds. `fetchTiktokCaption` must always send this header.
- **oEmbed only returns caption/embed metadata, never the video file** — identical limitation to Meta's oEmbed. A caption-less or narration-only video will fail this path and fall back to manual upload, same as today.
- **No formal API agreement exists** — this is a public, spec-compliant oEmbed endpoint, not a partnered integration. TikTok could change or restrict it without notice. Acceptable risk at this app's scale; not something to build extra resilience around beyond normal error handling.
- **Follow the existing Instagram/Facebook pattern exactly** — same shape of module (`detectXUrl` + `fetchXCaption`), same wiring point in `routes/import.ts`, same migration pattern, same generic error message. Per the approved brainstorming discussion, this iteration deliberately does **not** introduce a shared abstraction across YouTube/Meta/TikTok's caption-fetch paths — each stays separate, duplicated code, matching this codebase's existing convention of not abstracting between conceptually-similar-but-independent extraction methods.

## 4. Architecture overview

```
┌──────────────────────────┐
│ ImportPage "From URL"    │  paste a TikTok video link
└────────────┬──────────────┘
             │ POST /server/import { type: "url", url }
             ▼
┌──────────────────────────┐
│ routes/import.ts          │  detect TikTok URL (new branch, alongside
│ extraction/tiktokOembed.ts│  the existing YouTube/Meta checks)
└────────────┬──────────────┘
             │ GET https://www.tiktok.com/oembed?url=<url>
             │ (browser User-Agent header, no token)
             ▼
   caption text extracted from the response's "title" field
             │
             ▼
   (existing extractRecipeWithLlm — unchanged, same as the
    YouTube description fallback and Meta's caption path)
```

## 5. Data model changes

```sql
-- 0008_widen_import_source_types_tiktok.sql
alter table recipes drop constraint if exists recipes_source_type_check;
alter table recipes add constraint recipes_source_type_check
  check (source_type in ('web', 'youtube', 'photo', 'text', 'video', 'instagram', 'facebook', 'tiktok'));
```

`sourceType` unions widened to include `'tiktok'` in `src/app/lib/types.ts` (`Recipe.sourceType`) and `src/app/pages/ImportPage.tsx` (`SourceType`).

## 6. Extraction pipeline

New module `supabase/functions/server/extraction/tiktokOembed.ts`, mirroring `metaOembed.ts`'s shape but simpler (no access token, no `platform` parameter since there's only one provider in this file):

```ts
export function detectTiktokUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com)\//i.test(url);
}

export async function fetchTiktokCaption(url: string, fetchFn: typeof fetch): Promise<string> {
  const requestUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  const response = await fetchFn(requestUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TikTok oEmbed request failed: ${response.status} ${body}`);
  }
  const data = await response.json();
  const caption = data?.title;
  if (typeof caption !== "string" || caption.trim().length === 0) {
    throw new Error("Post has no caption to extract a recipe from");
  }
  return caption;
}
```

`routes/import.ts`'s `type === "url"` branch, after the existing YouTube-ID and Meta-URL checks, adds a TikTok check:

```ts
const videoId = extractYoutubeVideoId(url);
const metaMatch = videoId ? null : detectMetaUrl(url);
const isTiktok = !videoId && !metaMatch && detectTiktokUrl(url);
sourceType = videoId ? "youtube" : metaMatch ? metaMatch.platform : isTiktok ? "tiktok" : "web";

// ...inside the existing if/else chain, alongside the metaMatch branch:
} else if (isTiktok) {
  const caption = await deps.fetchTiktokCaption(url);
  draft = await extractRecipeWithLlm(caption, deps.llmClientFactory());
} else if (metaMatch) {
  ...
```

`ImportAppDeps` gains `fetchTiktokCaption: (url: string) => Promise<string>`, wired in `index.ts` as `fetchTiktokCaption: (url) => fetchTiktokCaption(url, fetch)` — no new secrets, no new environment variables.

## 7. Frontend changes

- `src/app/lib/tiktokUrl.ts` (new, small, mirrors `metaUrl.ts`): `isTiktokUrl(url): boolean`, same regex as `detectTiktokUrl` (duplicated deliberately — the frontend and backend URL checks already aren't shared for Instagram/Facebook either, per `metaUrl.ts` vs `metaOembed.ts`'s `detectMetaUrl`).
- `ImportPage.tsx`: the single call site that decides whether to show the platform-specific nudge (`isMetaUrl`) becomes `isMetaUrl || isTiktokUrl(body.url)` — kept as two separate named checks OR'd together, not merged into one function, per the approved decision not to introduce shared abstraction.
- `import.urlPlaceholder` updated in `en`/`it`/`fr` to mention TikTok alongside the existing YouTube/Instagram/Facebook mention.
- `import.metaImportError` is reused unchanged — its wording ("Couldn't get a recipe from that link — try uploading the video or a few screenshots instead.") is already platform-agnostic.

## 8. Error handling

A failed or caption-less TikTok fetch (private video, deleted video, narration-only video, an oEmbed hiccup) throws inside the new branch, falls through to `routes/import.ts`'s existing catch-all → generic 502 → the same reused nudge message on the frontend. This is identical to how Meta's failures are already handled — no new error paths, no App-Review-specific messaging (that failure mode doesn't exist for this provider).

## 9. Testing strategy

- `tiktokOembed.test.ts` (mirrors `metaOembed.test.ts`): `detectTiktokUrl` matches for `tiktok.com` and `vm.tiktok.com`, no-match for unrelated URLs; `fetchTiktokCaption` success (extracts `title`), failure (non-OK response), and no-caption cases, all via a mocked `fetch`.
- `import.test.ts` additions: a TikTok URL routes through the new branch and returns `sourceType: "tiktok"`, mirroring the existing Instagram/Facebook test cases.
- `tiktokUrl.test.ts` (frontend, mirrors `metaUrl.test.ts`).
- `e2e/import-tiktok-url.spec.ts` (new, mirrors `e2e/import-meta-url.spec.ts`): mocked backend response through to the review screen.

## 10. Build order

1. Backend extraction module + its unit tests (`tiktokOembed.ts`).
2. Wire into `routes/import.ts` + `index.ts`, with `import.test.ts` additions.
3. DB migration (created here, applied by the user by hand — same process as migration `0007`).
4. Frontend: `tiktokUrl.ts` + its test, `ImportPage.tsx`'s nudge check, i18n placeholder update.
5. e2e spec.
6. Full verification pass (existing test suites + build), and a note to the user about applying the migration and deploying the edge function themselves.

## 11. Explicitly deferred (not this iteration)

- TikTok video download.
- Any transcript/subtitle extraction for narration-only videos.
- A shared abstraction across YouTube/Meta/TikTok's caption-fetch paths (deliberately rejected for this iteration — see §3).
- Any TikTok-specific UI affordance beyond the existing generic "From URL" tab (no new tab, no TikTok-branded copy beyond the placeholder mention).
