# TikTok Video Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users import a recipe by pasting a TikTok video URL, using TikTok's public, unauthenticated oEmbed endpoint to fetch the caption text — no developer app, no App Review, unlike the existing Instagram/Facebook path.

**Architecture:** A new `tiktokOembed.ts` module (mirroring the existing `metaOembed.ts` but without any access token) detects TikTok URLs and fetches their caption via `GET https://www.tiktok.com/oembed`. `routes/import.ts` gets a new branch alongside its existing YouTube/Meta checks that runs this caption through the same `extractRecipeWithLlm` text pipeline already shared by the YouTube-description fallback and the Meta caption path. A new `'tiktok'` value is added to the `source_type` DB constraint and to every frontend `sourceType` union.

**Tech Stack:** Deno (Supabase Edge Functions, `deno test`), React/TypeScript frontend (Vite, `vitest`), Playwright (e2e), Supabase Postgres (SQL migrations).

**Spec:** `docs/superpowers/specs/2026-09-05-tiktok-import-design.md`

## Global Constraints

- No access token, no developer app registration, no App Review for this provider — that's the entire point of this feature versus Instagram/Facebook (spec §3).
- `fetchTiktokCaption` must always send a browser-like `User-Agent` header — confirmed during the spike that TikTok's WAF can block requests without one (spec §3, §6).
- Deliberately no shared abstraction across YouTube/Meta/TikTok's caption-fetch code — each stays separate, duplicated code, matching this codebase's existing convention (spec §3, confirmed with the user during brainstorming).
- This plan does **not** apply migration 0008 to the hosted Supabase project or deploy the edge function — the user does this by hand (no Supabase CLI is installed in this environment).
- This plan does **not** produce live Playwright screenshots against the deployed app for this feature — no way to verify end-to-end without the migration already applied and the function already deployed with this code, both of which happen after this plan's tasks land locally. Verification is via `deno test`, `vitest run`, and the production build; the new e2e spec is written but not run against a live deployment by this plan.

---

### Task 1: `tiktokOembed` extraction module

**Files:**
- Create: `supabase/functions/server/extraction/tiktokOembed.ts`
- Test: `supabase/functions/server/extraction/tiktokOembed.test.ts`

**Interfaces:**
- Consumes: nothing new — only the global `fetch` type.
- Produces: `detectTiktokUrl(url: string): boolean` and `fetchTiktokCaption(url: string, fetchFn: typeof fetch): Promise<string>`. Task 2 imports both.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/server/extraction/tiktokOembed.test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectTiktokUrl, fetchTiktokCaption } from "./tiktokOembed.ts";

function fakeFetch(
  status: number,
  body: unknown,
): { fetchFn: typeof fetch; getLastCall: () => { url: string; headers: Record<string, string> } } {
  let lastUrl = "";
  let lastHeaders: Record<string, string> = {};
  const fetchFn = (async (url: string, init?: RequestInit) => {
    lastUrl = url;
    lastHeaders = (init?.headers as Record<string, string>) ?? {};
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchFn, getLastCall: () => ({ url: lastUrl, headers: lastHeaders }) };
}

Deno.test("detects tiktok.com URLs", () => {
  assertEquals(detectTiktokUrl("https://www.tiktok.com/@cookist/video/7644494880604982550"), true);
  assertEquals(detectTiktokUrl("https://tiktok.com/@user/video/123"), true);
});

Deno.test("detects vm.tiktok.com short links", () => {
  assertEquals(detectTiktokUrl("https://vm.tiktok.com/ABC123/"), true);
});

Deno.test("returns false for unrelated URLs", () => {
  assertEquals(detectTiktokUrl("https://example.com/recipe"), false);
  assertEquals(detectTiktokUrl("https://youtu.be/abcdefghijk"), false);
});

Deno.test("extracts the caption from a successful oEmbed response", async () => {
  const { fetchFn } = fakeFetch(200, { title: "1kg flour, 500ml water. Mix and bake." });
  const caption = await fetchTiktokCaption("https://www.tiktok.com/@user/video/123", fetchFn);
  assertEquals(caption, "1kg flour, 500ml water. Mix and bake.");
});

Deno.test("requests the TikTok oEmbed endpoint with the url and a browser User-Agent header", async () => {
  const { fetchFn, getLastCall } = fakeFetch(200, { title: "Recipe text" });
  await fetchTiktokCaption("https://www.tiktok.com/@user/video/123", fetchFn);
  const { url, headers } = getLastCall();
  assertEquals(url.includes("www.tiktok.com/oembed"), true);
  assertEquals(url.includes("url=https%3A%2F%2Fwww.tiktok.com%2F%40user%2Fvideo%2F123"), true);
  assertEquals(headers["User-Agent"].includes("Mozilla"), true);
});

Deno.test("throws when the oEmbed request itself fails", async () => {
  const { fetchFn } = fakeFetch(400, { message: "Something went wrong", code: 400 });
  await assertRejects(
    () => fetchTiktokCaption("https://www.tiktok.com/@user/video/123", fetchFn),
    Error,
    "TikTok oEmbed request failed",
  );
});

Deno.test("throws when the response has no caption", async () => {
  const { fetchFn } = fakeFetch(200, { title: "" });
  await assertRejects(
    () => fetchTiktokCaption("https://www.tiktok.com/@user/video/123", fetchFn),
    Error,
    "Post has no caption",
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-net --allow-env supabase/functions/server/extraction/tiktokOembed.test.ts`
Expected: fails to load — `tiktokOembed.ts` does not exist yet (`Module not found`).

- [ ] **Step 3: Write the implementation**

```ts
// supabase/functions/server/extraction/tiktokOembed.ts

// TikTok's oEmbed endpoint is public and unauthenticated - no developer
// app, no access token, no App Review, unlike Meta's equivalent (see
// docs/superpowers/specs/2026-09-05-tiktok-import-design.md). Confirmed
// live during the spike that predates this file: a request without a
// browser-like User-Agent can be blocked by TikTok's WAF, while one with
// a standard browser UA string succeeds - always send this header.
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-net --allow-env supabase/functions/server/extraction/tiktokOembed.test.ts`
Expected: `7 passed | 0 failed`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/server/extraction/tiktokOembed.ts supabase/functions/server/extraction/tiktokOembed.test.ts
git commit -m "feat: add TikTok oEmbed caption extraction module"
```

---

### Task 2: Wire TikTok into the import route, and add the DB migration

**Files:**
- Modify: `supabase/functions/server/routes/import.ts`
- Modify: `supabase/functions/server/routes/import.test.ts`
- Modify: `supabase/functions/server/index.ts`
- Create: `supabase/migrations/0008_widen_import_source_types_tiktok.sql`

**Interfaces:**
- Consumes: `detectTiktokUrl`, `fetchTiktokCaption` from Task 1 (`./extraction/tiktokOembed.ts`).
- Produces: `ImportAppDeps` gains a new required field `fetchTiktokCaption: (url: string) => Promise<string>`. The `sourceType` response value `"tiktok"` is now possible.

- [ ] **Step 1: Add the import and the new required dep field**

In `supabase/functions/server/routes/import.ts`, add the import alongside the existing `detectMetaUrl` one:

```ts
import { detectMetaUrl } from "../extraction/metaOembed.ts";
import { detectTiktokUrl } from "../extraction/tiktokOembed.ts";
```

In the `ImportAppDeps` interface, add a new field right after `fetchMetaCaption`:

```ts
export interface ImportAppDeps {
  getUserId: (authHeader: string | undefined) => Promise<string | null>;
  fetchYoutubeTranscript: (videoId: string) => Promise<string>;
  fetchYoutubeVideoInfo: (videoId: string) => Promise<YoutubeVideoInfo>;
  fetchMetaCaption: (url: string, platform: "instagram" | "facebook") => Promise<string>;
  fetchTiktokCaption: (url: string) => Promise<string>;
  llmClientFactory: () => MessagesClient;
  countRecentImports: (userId: string) => Promise<number>;
  recordImportAttempt: (userId: string) => Promise<void>;
}
```

Widen the `sourceType` local variable's type declaration:

```ts
let sourceType: "web" | "youtube" | "text" | "photo" | "instagram" | "facebook" | "tiktok";
```

- [ ] **Step 2: Write the failing tests**

Add to `supabase/functions/server/routes/import.test.ts` (append near the existing Meta tests — find `Deno.test("falls back to the generic error path when Meta caption fetching fails"` and add these two right after that test):

```ts
Deno.test("routes TikTok URLs through the TikTok caption path", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    fetchTiktokCaption: async (url) => {
      assertEquals(url, "https://www.tiktok.com/@cookist/video/7644494880604982550");
      return "300g flour, 4g salt, 175ml boiling water. Mix and rest for 1 hour.";
    },
    llmClientFactory: () =>
      fakeLlmClient({ title: "Gyoza", complexity: null, servings: null, ingredients: [], steps: [] }),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "url", url: "https://www.tiktok.com/@cookist/video/7644494880604982550" }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.sourceType, "tiktok");
  assertEquals(body.draft.title, "Gyoza");
});

Deno.test("falls back to the generic error path when TikTok caption fetching fails", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    fetchTiktokCaption: async () => {
      throw new Error("Post has no caption to extract a recipe from");
    },
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "url", url: "https://www.tiktok.com/@user/video/123" }),
  });
  assertEquals(response.status, 502);
});
```

- [ ] **Step 3: Run the tests to verify they fail correctly**

Run: `deno test --allow-net --allow-env supabase/functions/server/routes/import.test.ts`

Expected: this fails with TypeScript errors, NOT test assertion failures — every existing `buildImportApp({...})` call in this file is now missing the newly-required `fetchTiktokCaption` field from `ImportAppDeps` (added in Step 1). Deno's type-checker reports this as something like:

```
error: TS2345 [ERROR]: Argument of type '{ getUserId: ...; fetchMetaCaption: ...; ... }' is not assignable to parameter of type 'ImportAppDeps'.
  Property 'fetchTiktokCaption' is missing in type '...' but required in type 'ImportAppDeps'.
```

This is expected — it's the compiler telling you exactly which object literals need updating in the next step, one error per fixture.

- [ ] **Step 4: Add `fetchTiktokCaption` to every existing test fixture in this file**

Every `buildImportApp({...})` call in `import.test.ts` — except the two you just added in Step 2, which already have their own — needs a `fetchTiktokCaption: async () => "",` field added to its object literal, on its own line, placed right after that fixture's `fetchMetaCaption` field (wherever that field's value ends — some are one-liners, some are multi-line arrow functions; place the new field immediately after the line containing that field's closing comma).

Do this for every fixture, then re-run the command from Step 3. Deno's type-checker will report one `TS2345`/"Property 'fetchTiktokCaption' is missing" error per fixture still missing it, each with the exact file:line of that `buildImportApp({...})` call — keep adding the field and re-running until the type-check passes (zero `TS2345` errors), then move to Step 5. This file has roughly 30 such fixtures as of this plan; the compiler's error list is the source of truth for exactly which ones remain, not this count.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test --allow-net --allow-env supabase/functions/server/routes/import.test.ts`
Expected: all tests pass (roughly 32: the ~30 pre-existing ones plus the 2 new ones from Step 2).

- [ ] **Step 6: Write the implementation in `import.ts`**

In the `type === "url"` branch, change:

```ts
        const videoId = extractYoutubeVideoId(url);
        const metaMatch = videoId ? null : detectMetaUrl(url);
        sourceType = videoId ? "youtube" : metaMatch ? metaMatch.platform : "web";
```

to:

```ts
        const videoId = extractYoutubeVideoId(url);
        const metaMatch = videoId ? null : detectMetaUrl(url);
        const isTiktok = !videoId && !metaMatch && detectTiktokUrl(url);
        sourceType = videoId ? "youtube" : metaMatch ? metaMatch.platform : isTiktok ? "tiktok" : "web";
```

Then, add a new `else if` branch right after the existing `metaMatch` branch and before the final `else` (the plain-web-page branch):

```ts
        } else if (metaMatch) {
          const caption = await deps.fetchMetaCaption(url, metaMatch.platform);
          draft = await extractRecipeWithLlm(caption, deps.llmClientFactory());
        } else if (isTiktok) {
          const caption = await deps.fetchTiktokCaption(url);
          draft = await extractRecipeWithLlm(caption, deps.llmClientFactory());
        } else {
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `deno test --allow-net --allow-env supabase/functions/server/routes/import.test.ts`
Expected: same as Step 5 — all tests pass.

- [ ] **Step 8: Wire the real implementation in `index.ts`**

Add the import:

```ts
import { fetchTiktokCaption } from "./extraction/tiktokOembed.ts";
```

In the `buildImportApp({...})` call, add a new field right after `fetchMetaCaption`:

```ts
    fetchMetaCaption: (url, platform) => fetchMetaCaption(url, platform, `${metaAppId}|${metaClientToken}`, fetch),
    fetchTiktokCaption: (url) => fetchTiktokCaption(url, fetch),
```

- [ ] **Step 9: Create the DB migration**

```sql
-- supabase/migrations/0008_widen_import_source_types_tiktok.sql
-- Adds 'tiktok' as a source_type for TikTok video URL imports. Caption
-- fetched via TikTok's public, unauthenticated oEmbed endpoint - no
-- developer app or App Review needed, unlike Instagram/Facebook. See
-- docs/superpowers/specs/2026-09-05-tiktok-import-design.md.
alter table recipes drop constraint if exists recipes_source_type_check;
alter table recipes add constraint recipes_source_type_check
  check (source_type in ('web', 'youtube', 'photo', 'text', 'video', 'instagram', 'facebook', 'tiktok'));
```

This migration is **not applied** to the hosted project by this task — per the Global Constraints, the user applies it by hand.

- [ ] **Step 10: Run the full server test suite to confirm nothing else broke**

Run: `deno test --allow-net --allow-env supabase/functions/server`
Expected: all tests pass, including the pre-existing extraction/route test files.

- [ ] **Step 11: Commit**

```bash
git add supabase/functions/server/routes/import.ts supabase/functions/server/routes/import.test.ts supabase/functions/server/index.ts supabase/migrations/0008_widen_import_source_types_tiktok.sql
git commit -m "feat: route TikTok URLs through the TikTok caption path, add tiktok source_type"
```

---

### Task 3: Frontend TikTok URL check, sourceType widening, and i18n

**Files:**
- Create: `src/app/lib/tiktokUrl.ts`
- Test: `src/app/lib/tiktokUrl.test.ts`
- Modify: `src/app/lib/types.ts`
- Modify: `src/app/lib/recipesApi.ts`
- Modify: `src/app/pages/ImportPage.tsx`
- Modify: `src/app/lib/i18n/translations.ts`

**Interfaces:**
- Consumes: nothing from other tasks (this task is frontend-only and does not call the new backend module directly).
- Produces: `isTiktokUrl(url: string): boolean`, exported from `src/app/lib/tiktokUrl.ts`. No other task depends on this task's output.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/lib/tiktokUrl.test.ts
import { describe, it, expect } from 'vitest'
import { isTiktokUrl } from './tiktokUrl'

describe('isTiktokUrl', () => {
  it('detects tiktok.com URLs', () => {
    expect(isTiktokUrl('https://www.tiktok.com/@user/video/123')).toBe(true)
    expect(isTiktokUrl('https://tiktok.com/@user/video/123')).toBe(true)
  })

  it('detects vm.tiktok.com short links', () => {
    expect(isTiktokUrl('https://vm.tiktok.com/ABC123/')).toBe(true)
  })

  it('returns false for unrelated URLs', () => {
    expect(isTiktokUrl('https://example.com/recipe')).toBe(false)
    expect(isTiktokUrl('https://youtu.be/abcdefghijk')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/lib/tiktokUrl.test.ts`
Expected: fails — `tiktokUrl.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/lib/tiktokUrl.ts
export function isTiktokUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com)\//i.test(url)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/lib/tiktokUrl.test.ts`
Expected: `3 passed`

- [ ] **Step 5: Widen the `sourceType` unions**

In `src/app/lib/types.ts`, change:

```ts
  sourceType: 'web' | 'youtube' | 'photo' | 'text' | 'video' | 'instagram' | 'facebook'
```

to:

```ts
  sourceType: 'web' | 'youtube' | 'photo' | 'text' | 'video' | 'instagram' | 'facebook' | 'tiktok'
```

In `src/app/lib/recipesApi.ts`, change:

```ts
  sourceType: 'web' | 'youtube' | 'photo' | 'text' | 'video' | 'instagram' | 'facebook'
```

to:

```ts
  sourceType: 'web' | 'youtube' | 'photo' | 'text' | 'video' | 'instagram' | 'facebook' | 'tiktok'
```

In `src/app/pages/ImportPage.tsx`, change:

```ts
type SourceType = 'web' | 'youtube' | 'photo' | 'text' | 'video' | 'instagram' | 'facebook'
```

to:

```ts
type SourceType = 'web' | 'youtube' | 'photo' | 'text' | 'video' | 'instagram' | 'facebook' | 'tiktok'
```

- [ ] **Step 6: Update the nudge-message check in `ImportPage.tsx`**

Change the import:

```ts
import { isInstagramOrFacebookUrl } from '../lib/metaUrl'
```

to:

```ts
import { isInstagramOrFacebookUrl } from '../lib/metaUrl'
import { isTiktokUrl } from '../lib/tiktokUrl'
```

Change:

```ts
      const isMetaUrl = body.type === 'url' && isInstagramOrFacebookUrl(body.url)
```

to:

```ts
      const isMetaUrl = body.type === 'url' && (isInstagramOrFacebookUrl(body.url) || isTiktokUrl(body.url))
```

(The variable name `isMetaUrl` stays as-is — renaming it is out of scope for this task; it now means "a URL whose failure should show the upload-fallback nudge instead of the generic error," which the two OR'd checks already express correctly without a rename.)

- [ ] **Step 7: Update the URL placeholder copy in all three languages**

In `src/app/lib/i18n/translations.ts`, change the English entry:

```ts
  'import.urlPlaceholder': 'https://example.com/recipe, a YouTube URL, or an Instagram/Facebook Reel link',
```

to:

```ts
  'import.urlPlaceholder': 'https://example.com/recipe, a YouTube URL, a TikTok video, or an Instagram/Facebook Reel link',
```

the Italian entry:

```ts
  'import.urlPlaceholder': 'https://esempio.com/ricetta, un URL YouTube o un link a un Reel di Instagram/Facebook',
```

to:

```ts
  'import.urlPlaceholder': 'https://esempio.com/ricetta, un URL YouTube, un video TikTok o un link a un Reel di Instagram/Facebook',
```

and the French entry:

```ts
  'import.urlPlaceholder': 'https://exemple.com/recette, une URL YouTube ou un lien vers un Reel Instagram/Facebook',
```

to:

```ts
  'import.urlPlaceholder': 'https://exemple.com/recette, une URL YouTube, une vidéo TikTok ou un lien vers un Reel Instagram/Facebook',
```

- [ ] **Step 8: Run the frontend test suite and build**

Run: `npx vitest run && node ./node_modules/vite/bin/vite.js build`
Expected: all tests pass, build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/app/lib/tiktokUrl.ts src/app/lib/tiktokUrl.test.ts src/app/lib/types.ts src/app/lib/recipesApi.ts src/app/pages/ImportPage.tsx src/app/lib/i18n/translations.ts
git commit -m "feat: widen sourceType to include tiktok, add TikTok URL nudge check and copy"
```

---

### Task 4: e2e spec for the TikTok URL path

**Files:**
- Create: `e2e/import-tiktok-url.spec.ts`

**Interfaces:**
- Consumes: `signInAsNewUser` from `./helpers/auth` (already exists, unchanged).
- Produces: nothing consumed by other tasks.

This spec is not runnable against a live deployment by this plan (per Global Constraints — the migration and edge function deploy happen after these tasks land, by the user, by hand). It's written now so it exists and matches the established per-provider e2e pattern (`import-meta-url.spec.ts`); the user runs `npx playwright test` themselves once the backend is actually deployed.

- [ ] **Step 1: Write the spec**

```ts
// e2e/import-tiktok-url.spec.ts
import { test, expect } from '@playwright/test'
import { signInAsNewUser } from './helpers/auth'

test('pasting a TikTok link that fails shows the upload-fallback message, not the generic one', async ({ page }) => {
  const { cleanup } = await signInAsNewUser(page)
  try {
    await page.goto('/import')
    await page
      .getByLabel('Recipe URL')
      .fill('https://www.tiktok.com/@nonexistent-fixture-account/video/0000000000000000000')
    await page.getByRole('button', { name: 'Import' }).click()

    // No guarantee this specific fixture video exists or has a usable
    // caption against the real TikTok oEmbed endpoint, so this call is
    // expected to fail - the point of this test is confirming the failure
    // surfaces the same upload-fallback nudge Instagram/Facebook already
    // use, not the generic import error message.
    await expect(page.getByText("Couldn't get a recipe from that link")).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: 'screenshot/import-tiktok-url-error.png' })
  } finally {
    await cleanup()
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add e2e/import-tiktok-url.spec.ts
git commit -m "test: add e2e spec for the TikTok URL import path"
```

---

### Task 5: Full verification pass

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full server test suite**

Run: `deno test --allow-net --allow-env supabase/functions/server`
Expected: all tests pass (including Tasks 1 and 2's new tests).

- [ ] **Step 2: Run the full frontend test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Run the production build**

Run: `node ./node_modules/vite/bin/vite.js build`
Expected: builds successfully.

- [ ] **Step 4: Report remaining manual steps to the user**

No code changes in this step — summarize for the user, in the chat response (not a file), that:
1. Migration `0008_widen_import_source_types_tiktok.sql` still needs to be applied to the hosted project by them (via the Supabase dashboard's SQL editor, same as migration `0007`).
2. The updated edge function (`supabase/functions/server`) still needs to be deployed by them (same manual dashboard paste as before — three files changed: `extraction/tiktokOembed.ts` (new), `routes/import.ts`, `index.ts`).
3. `e2e/import-tiktok-url.spec.ts` exists but was not run against a live deployment by this plan — the user can run `npx playwright test import-tiktok-url` themselves once the migration/deploy are done.
4. No Playwright screenshots were produced for this feature during this plan's execution, per the earlier decision — visual verification happens once the user has applied the migration/deploy and can test a real TikTok URL themselves.
