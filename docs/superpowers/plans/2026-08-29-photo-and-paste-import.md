# Photo Capture & Paste-Text Recipe Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new ways to import a recipe into Ricettario — taking one or more camera photos (extracted via the LLM's vision input) and pasting raw recipe text — alongside the existing "import from URL" flow.

**Architecture:** Both new inputs feed the same edge-function extraction pipeline and the same client-side draft-review-then-save screen the URL flow already uses. The `POST /server/import` request body becomes a discriminated union (`url` | `text` | `images`); `text` reuses the existing `extractRecipeWithLlm` directly (skipping fetch/JSON-LD), and `images` adds a new vision-based extraction function using the same model and structured-output schema. No new storage: photos are compressed client-side, sent to the edge function for extraction, and discarded — never persisted.

**Tech Stack:** Vite + React 18 + react-router-dom (frontend), Hono on Deno (Supabase Edge Function), `@anthropic-ai/sdk` (`claude-haiku-4-5`, vision + structured JSON output), Vitest (frontend unit tests), Deno test (backend unit tests), Playwright (e2e).

**Spec:** This plan was written directly from a design approved in chat (no separate spec file) — see the conversation history for the brainstorming/design discussion this argues from.

## Global Constraints

- Do not run `supabase db push` (or any command that applies a migration to the linked hosted Supabase project) without the user's explicit go-ahead first — it's a schema change to a live, shared, external database. Create and commit the migration file; flag that it still needs to be pushed, and stop there.
- No Supabase Storage bucket, no image persistence. Photos exist only in the browser and in one edge-function request; they are never written to disk/DB. `Recipe.imageUrl` is unaffected by this feature.
- Reuse the existing daily rate limit unchanged for all three import types: `hasImportCapacity`/`countRecentImports`/`recordImportAttempt` against the `import_attempts` table (`supabase/functions/server/rateLimit.ts`). Do not add a second limit.
- Max 5 photos per import, enforced in two places: client-side (disable "Add photo" once 5 are staged) and server-side (400 if the `images` array has 0 or more than 5 entries).
- LLM model for every extraction call (text, images, or the existing URL path): `claude-haiku-4-5`, via `output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } }` — unchanged from the existing code.
- `src/app/lib/types.ts`'s `RecipeDraft`/`RecipeDraftIngredient`/`RecipeDraftStep` are hand-mirrored against `supabase/functions/server/extraction/types.ts` (no shared package between the Deno edge function and the Vite frontend) — keep both in sync whenever one changes.
- Verification commands available in this repo: `npm test` (Vitest, frontend), `npm run build` (tsc + vite build), `npm run test:e2e` (Playwright), `deno test --allow-net <path>` (backend — the `--allow-net` flag is required because import.test.ts spins up a local fixture HTTP server; e.g. `deno test --allow-net supabase/functions/server/routes/import.test.ts`).

## Files

- **Create:** `supabase/migrations/0003_widen_import_source_types.sql`
- **Create:** `supabase/functions/server/extraction/llmShared.ts` (shared `DRAFT_SCHEMA` + response parsing, factored out of `llmExtract.ts`)
- **Modify:** `supabase/functions/server/extraction/llmExtract.ts` (use the shared module; behavior unchanged)
- **Create:** `supabase/functions/server/extraction/llmExtractImages.ts` (new vision extraction function)
- **Create:** `supabase/functions/server/extraction/llmExtractImages.test.ts`
- **Modify:** `supabase/functions/server/routes/import.ts` (discriminated request body; `text` and `images` branches)
- **Modify:** `supabase/functions/server/routes/import.test.ts`
- **Modify:** `src/app/lib/types.ts` (`Recipe.sourceUrl` nullable; `sourceType` widened)
- **Modify:** `src/app/lib/recipesApi.ts` (`SaveRecipeInput` matches the above)
- **Modify:** `src/app/pages/RecipeDetailPage.tsx` (hide the "Source" link when there's no `sourceUrl`)
- **Create:** `src/app/lib/imageResize.ts`
- **Create:** `src/app/lib/imageResize.test.ts`
- **Modify:** `src/app/pages/ImportPage.tsx` (tabbed mode selector: From URL / Take Photos / Paste Text)
- **Create:** `e2e/import-paste-text.spec.ts`
- **Create:** `e2e/import-photo.spec.ts`
- **Create:** `e2e/fixtures/recipe-photo.png` (tiny fixture image for the photo e2e test)
- **Create:** `screenshot/` (manual verification proof, gitignored is not required — matches existing `e2e/screenshots/` convention of being committed)

---

### Task 1: Widen the DB schema for photo/text sources

**Files:**
- Create: `supabase/migrations/0003_widen_import_source_types.sql`

**Interfaces:**
- Produces: a `recipes.source_url` column that accepts `NULL`, and a `recipes.source_type` check constraint that also accepts `'photo'` and `'text'` (alongside the existing `'web'`, `'youtube'`).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0003_widen_import_source_types.sql
alter table recipes alter column source_url drop not null;

alter table recipes drop constraint if exists recipes_source_type_check;
alter table recipes add constraint recipes_source_type_check
  check (source_type in ('web', 'youtube', 'photo', 'text'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0003_widen_import_source_types.sql
git commit -m "feat: allow null source_url and photo/text source types"
```

- [ ] **Step 3: Stop — do not push this migration**

Per Global Constraints, do not run `supabase db push` (or any equivalent command) against the linked hosted project. Report back that the migration file is committed and still needs to be applied to the hosted project before Task 6/7's e2e tests (which save a recipe with a null `source_url`) can pass end-to-end against real data.

---

### Task 2: Factor out shared LLM response parsing; add the paste-text import path

**Files:**
- Create: `supabase/functions/server/extraction/llmShared.ts`
- Modify: `supabase/functions/server/extraction/llmExtract.ts`
- Modify: `supabase/functions/server/routes/import.ts`
- Modify: `supabase/functions/server/routes/import.test.ts`

**Interfaces:**
- Produces (from `llmShared.ts`): `export const DRAFT_SCHEMA` (the existing JSON schema object, moved verbatim); `export interface LlmResponse { content: Array<{ type: string; text?: string }>; stop_reason?: string }`; `export function parseDraftResponse(response: LlmResponse): RecipeDraft`.
- Consumes (in `import.ts`): `extractRecipeWithLlm(sourceText: string, client: MessagesClient): Promise<RecipeDraft>` — unchanged signature, from `llmExtract.ts`.
- Produces (in `import.ts`): the request body type `type ImportRequestBody = { type: "url"; url: string } | { type: "text"; text: string }` (Task 3 extends this union with an `images` member).

- [ ] **Step 1: Extract the shared schema/parsing into `llmShared.ts`**

```typescript
// supabase/functions/server/extraction/llmShared.ts
import type { RecipeDraft } from "./types.ts";

export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    complexity: { type: ["string", "null"] },
    servings: { type: ["string", "null"] },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rawText: { type: "string" },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          name: { type: "string" },
        },
        required: ["rawText", "name"],
        additionalProperties: false,
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          instruction: { type: "string" },
          estimatedMinutes: { type: ["number", "null"] },
        },
        required: ["instruction"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "ingredients", "steps"],
  additionalProperties: false,
};

export interface LlmResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string;
}

export function parseDraftResponse(response: LlmResponse): RecipeDraft {
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "LLM response was truncated (hit max_tokens) — the recipe may be too long to extract in one call",
    );
  }

  const textBlock = response.content.find((block) => block.type === "text" && block.text);
  if (!textBlock?.text) throw new Error("No structured output returned");

  try {
    return JSON.parse(textBlock.text) as RecipeDraft;
  } catch (error) {
    throw new Error(
      `Failed to parse LLM structured output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
```

- [ ] **Step 2: Rewrite `llmExtract.ts` to use the shared module (behavior unchanged)**

```typescript
// supabase/functions/server/extraction/llmExtract.ts
import Anthropic from "npm:@anthropic-ai/sdk";
import type { RecipeDraft } from "./types.ts";
import { DRAFT_SCHEMA, parseDraftResponse, type LlmResponse } from "./llmShared.ts";

export interface MessagesClient {
  messages: {
    create(params: Record<string, unknown>): Promise<LlmResponse>;
  };
}

export async function extractRecipeWithLlm(sourceText: string, client: MessagesClient): Promise<RecipeDraft> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
    messages: [
      {
        role: "user",
        content:
          "Extract the recipe from the following text. Identify the title, ingredients (splitting out quantity/unit where possible, always keeping the original line as rawText), the ordered preparation steps, an estimated duration in minutes for each step, servings, and a complexity rating only if the source text states one explicitly.\n\n" +
          sourceText,
      },
    ],
  });

  return parseDraftResponse(response);
}

export function createAnthropicMessagesClient(apiKey: string): MessagesClient {
  // The real Anthropic SDK client's `messages.create` has a much richer,
  // overloaded signature than the minimal `MessagesClient` interface below
  // (which exists purely so tests can inject a fake). This cast adapts the
  // wider SDK type to that minimal shape; it performs no runtime conversion.
  return new Anthropic({ apiKey }) as unknown as MessagesClient;
}
```

- [ ] **Step 3: Run the existing extraction test to confirm the refactor didn't change behavior**

Run: `deno test --allow-net supabase/functions/server/extraction/llmExtract.test.ts`
Expected: PASS (all 3 existing tests, unchanged)

- [ ] **Step 4: Add the `text` import path to `import.ts`**

```typescript
// supabase/functions/server/routes/import.ts
import { Hono } from "npm:hono";
import { findRecipeJsonLd, jsonLdToDraft } from "../extraction/jsonld.ts";
import { htmlToVisibleText } from "../extraction/htmlToText.ts";
import { extractRecipeWithLlm, type MessagesClient } from "../extraction/llmExtract.ts";
import { extractYoutubeVideoId } from "../extraction/youtubeTranscript.ts";
import { hasImportCapacity } from "../rateLimit.ts";
import type { RecipeDraft } from "../extraction/types.ts";

export interface ImportAppDeps {
  getUserId: (authHeader: string | undefined) => Promise<string | null>;
  fetchYoutubeTranscript: (videoId: string) => Promise<string>;
  llmClientFactory: () => MessagesClient;
  countRecentImports: (userId: string) => Promise<number>;
  recordImportAttempt: (userId: string) => Promise<void>;
}

type ImportRequestBody = { type: "url"; url: string } | { type: "text"; text: string };

export function buildImportApp(deps: ImportAppDeps) {
  const app = new Hono();

  app.post("/server/import", async (c) => {
    const userId = await deps.getUserId(c.req.header("Authorization"));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const recentCount = await deps.countRecentImports(userId);
    if (!hasImportCapacity(recentCount)) {
      return c.json({ error: "Daily import limit reached" }, 429);
    }

    // Record the attempt now, before any network/LLM work — the limit bounds
    // attempts (which is what actually costs money), not saved recipes.
    await deps.recordImportAttempt(userId);

    try {
      const body = await c.req.json<ImportRequestBody>();

      let draft: RecipeDraft | null;
      let sourceType: "web" | "youtube" | "text";

      if (body.type === "text") {
        sourceType = "text";
        draft = await extractRecipeWithLlm(body.text, deps.llmClientFactory());
      } else if (body.type === "url") {
        const videoId = extractYoutubeVideoId(body.url);
        sourceType = videoId ? "youtube" : "web";

        if (videoId) {
          const transcript = await deps.fetchYoutubeTranscript(videoId);
          draft = await extractRecipeWithLlm(transcript, deps.llmClientFactory());
        } else {
          const pageResponse = await fetch(body.url);
          if (!pageResponse.ok) throw new Error(`Failed to fetch page: ${pageResponse.status}`);
          const html = await pageResponse.text();
          const jsonLd = findRecipeJsonLd(html);
          draft = jsonLd ? jsonLdToDraft(jsonLd) : null;
          if (!draft) {
            draft = await extractRecipeWithLlm(htmlToVisibleText(html), deps.llmClientFactory());
          }
        }
      } else {
        throw new Error(`Unsupported import type: ${(body as { type: string }).type}`);
      }

      return c.json({ draft, sourceType });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Import failed" }, 502);
    }
  });

  return app;
}
```

- [ ] **Step 5: Add tests for the `text` path to `import.test.ts`**

Add these two tests to the existing file (keep every existing test in the file — they still apply verbatim against the `url` branch):

```typescript
Deno.test("extracts a recipe from pasted text via the LLM, skipping the URL/transcript path", async () => {
  let transcriptFetched = false;
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => {
      transcriptFetched = true;
      return "";
    },
    llmClientFactory: () =>
      fakeLlmClient({ title: "Text Soup", complexity: null, servings: null, ingredients: [], steps: [] }),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "text", text: "Chop onions. Simmer for ten minutes." }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.sourceType, "text");
  assertEquals(body.draft.title, "Text Soup");
  assertEquals(transcriptFetched, false);
});

Deno.test("returns 502 with a descriptive message for an unrecognized import type", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "bogus" }),
  });
  const body = await response.json();
  assertEquals(response.status, 502);
  assertEquals(body.error, "Unsupported import type: bogus");
});
```

Also update every existing test in the file that builds a request body as `{ url }` to `{ type: "url", url }` — the route no longer accepts the old bare-`url` shape. There are 6 existing `JSON.stringify({ url })`/`JSON.stringify({ url: ... })` call sites in this file; change each to `JSON.stringify({ type: "url", url })` / `JSON.stringify({ type: "url", url: ... })`.

- [ ] **Step 6: Run the full import route test file**

Run: `deno test --allow-net supabase/functions/server/routes/import.test.ts`
Expected: PASS (7 existing tests updated to the new body shape + 2 new tests = 9 total)

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/server/extraction/llmShared.ts supabase/functions/server/extraction/llmExtract.ts supabase/functions/server/routes/import.ts supabase/functions/server/routes/import.test.ts
git commit -m "feat: add paste-text recipe import alongside URL import"
```

---

### Task 3: Add photo (vision) extraction

**Files:**
- Create: `supabase/functions/server/extraction/llmExtractImages.ts`
- Create: `supabase/functions/server/extraction/llmExtractImages.test.ts`
- Modify: `supabase/functions/server/routes/import.ts`
- Modify: `supabase/functions/server/routes/import.test.ts`

**Interfaces:**
- Consumes: `DRAFT_SCHEMA`, `parseDraftResponse` from `../extraction/llmShared.ts` (Task 2); `type MessagesClient` from `./llmExtract.ts`.
- Produces: `export interface ImageInput { mediaType: string; data: string }` and `export async function extractRecipeFromImages(images: ImageInput[], client: MessagesClient): Promise<RecipeDraft>`, both from `llmExtractImages.ts`. `images[].data` is base64-encoded image bytes with no `data:` URL prefix.

- [ ] **Step 1: Write `llmExtractImages.ts`**

```typescript
// supabase/functions/server/extraction/llmExtractImages.ts
import type { RecipeDraft } from "./types.ts";
import { DRAFT_SCHEMA, parseDraftResponse } from "./llmShared.ts";
import type { MessagesClient } from "./llmExtract.ts";

export interface ImageInput {
  mediaType: string;
  data: string;
}

const IMAGE_EXTRACTION_INSTRUCTIONS =
  "These photos show a recipe written or printed on paper, possibly spanning multiple photos taken in order. Extract the recipe from them. Identify the title, ingredients (splitting out quantity/unit where possible, always keeping the original line as rawText), the ordered preparation steps, an estimated duration in minutes for each step, servings, and a complexity rating only if stated explicitly.";

export async function extractRecipeFromImages(
  images: ImageInput[],
  client: MessagesClient,
): Promise<RecipeDraft> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: IMAGE_EXTRACTION_INSTRUCTIONS },
          ...images.map((image) => ({
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: image.data },
          })),
        ],
      },
    ],
  });

  return parseDraftResponse(response);
}
```

- [ ] **Step 2: Write `llmExtractImages.test.ts`**

```typescript
// supabase/functions/server/extraction/llmExtractImages.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractRecipeFromImages, type ImageInput } from "./llmExtractImages.ts";
import type { MessagesClient } from "./llmExtract.ts";

function capturingClient(draftJson: Record<string, unknown>): { client: MessagesClient; getLastParams: () => Record<string, unknown> } {
  let lastParams: Record<string, unknown> = {};
  const client: MessagesClient = {
    messages: {
      create: async (params) => {
        lastParams = params;
        return { content: [{ type: "text", text: JSON.stringify(draftJson) }] };
      },
    },
  };
  return { client, getLastParams: () => lastParams };
}

Deno.test("sends one text instruction block followed by an image block per photo", async () => {
  const images: ImageInput[] = [
    { mediaType: "image/jpeg", data: "aaa" },
    { mediaType: "image/jpeg", data: "bbb" },
  ];
  const { client, getLastParams } = capturingClient({
    title: "Photo Soup",
    complexity: null,
    servings: null,
    ingredients: [],
    steps: [],
  });

  const draft = await extractRecipeFromImages(images, client);

  assertEquals(draft.title, "Photo Soup");
  const params = getLastParams();
  const messages = params.messages as Array<{ content: Array<Record<string, unknown>> }>;
  const content = messages[0].content;
  assertEquals(content.length, 3);
  assertEquals(content[0].type, "text");
  assertEquals(content[1], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aaa" } });
  assertEquals(content[2], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "bbb" } });
});
```

- [ ] **Step 3: Run the new test file**

Run: `deno test --allow-net supabase/functions/server/extraction/llmExtractImages.test.ts`
Expected: PASS (1 test)

- [ ] **Step 4: Add the `images` import path to `import.ts`**

Apply these changes to `supabase/functions/server/routes/import.ts` from Task 2:

1. Add the import:

```typescript
import { extractRecipeFromImages, type ImageInput } from "../extraction/llmExtractImages.ts";
```

2. Add the constant (module scope, alongside the other top-level declarations):

```typescript
const MAX_IMAGES = 5;
```

3. Widen the request body type:

```typescript
type ImportRequestBody =
  | { type: "url"; url: string }
  | { type: "text"; text: string }
  | { type: "images"; images: ImageInput[] };
```

4. Widen the `sourceType` local variable's type from `"web" | "youtube" | "text"` to `"web" | "youtube" | "text" | "photo"`, and insert this branch between the existing `text` branch and the final `else`:

```typescript
      } else if (body.type === "images") {
        if (body.images.length === 0 || body.images.length > MAX_IMAGES) {
          return c.json({ error: `Provide between 1 and ${MAX_IMAGES} photos` }, 400);
        }
        sourceType = "photo";
        draft = await extractRecipeFromImages(body.images, deps.llmClientFactory());
      } else if (body.type === "url") {
```

(The existing `url` branch's `else if` keeps its body unchanged — only the branch above is new, and the final `else { throw new Error(...) }` stays last.)

- [ ] **Step 5: Add tests for the `images` path to `import.test.ts`**

```typescript
Deno.test("extracts a recipe from photos via the LLM vision call", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    llmClientFactory: () =>
      fakeLlmClient({ title: "Photo Soup", complexity: null, servings: null, ingredients: [], steps: [] }),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "images", images: [{ mediaType: "image/jpeg", data: "aaa" }] }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.sourceType, "photo");
  assertEquals(body.draft.title, "Photo Soup");
});

Deno.test("rejects an images request with no photos", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "images", images: [] }),
  });
  assertEquals(response.status, 400);
});

Deno.test("rejects an images request with more than 5 photos", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const sixImages = Array.from({ length: 6 }, () => ({ mediaType: "image/jpeg", data: "aaa" }));
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "images", images: sixImages }),
  });
  assertEquals(response.status, 400);
});
```

- [ ] **Step 6: Run the full import route test file**

Run: `deno test --allow-net supabase/functions/server/routes/import.test.ts`
Expected: PASS (9 existing + 3 new = 12 total)

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/server/extraction/llmExtractImages.ts supabase/functions/server/extraction/llmExtractImages.test.ts supabase/functions/server/routes/import.ts supabase/functions/server/routes/import.test.ts
git commit -m "feat: add photo (vision) recipe import"
```

---

### Task 4: Widen the frontend data layer for photo/text sources

**Files:**
- Modify: `src/app/lib/types.ts`
- Modify: `src/app/lib/recipesApi.ts`
- Modify: `src/app/pages/RecipeDetailPage.tsx`

**Interfaces:**
- Produces: `Recipe.sourceUrl: string | null`, `Recipe.sourceType: 'web' | 'youtube' | 'photo' | 'text'`, `SaveRecipeInput.sourceUrl: string | null`, `SaveRecipeInput.sourceType: 'web' | 'youtube' | 'photo' | 'text'` — consumed by Task 6/7's `ImportPage.tsx`.

- [ ] **Step 1: Widen `Recipe` in `types.ts`**

In `src/app/lib/types.ts`, change:

```typescript
export interface Recipe {
  id: string
  ownerId: string
  title: string
  sourceUrl: string
  sourceType: 'web' | 'youtube'
  imageUrl: string | null
  complexity: string | null
  servings: string | null
  createdAt: string
}
```

to:

```typescript
export interface Recipe {
  id: string
  ownerId: string
  title: string
  sourceUrl: string | null
  sourceType: 'web' | 'youtube' | 'photo' | 'text'
  imageUrl: string | null
  complexity: string | null
  servings: string | null
  createdAt: string
}
```

- [ ] **Step 2: Widen `SaveRecipeInput` in `recipesApi.ts`**

In `src/app/lib/recipesApi.ts`, change:

```typescript
export interface SaveRecipeInput {
  title: string
  sourceUrl: string
  sourceType: 'web' | 'youtube'
  imageUrl: string | null
  complexity: string | null
  servings: string | null
  ingredients: { rawText: string; quantity: number | null; unit: string | null; name: string }[]
  steps: { instruction: string; estimatedMinutes: number | null }[]
}
```

to:

```typescript
export interface SaveRecipeInput {
  title: string
  sourceUrl: string | null
  sourceType: 'web' | 'youtube' | 'photo' | 'text'
  imageUrl: string | null
  complexity: string | null
  servings: string | null
  ingredients: { rawText: string; quantity: number | null; unit: string | null; name: string }[]
  steps: { instruction: string; estimatedMinutes: number | null }[]
}
```

No other code in `recipesApi.ts` needs to change — `saveRecipe`'s insert already passes `input.sourceUrl`/`input.sourceType` straight through, and `getRecipe`'s mapping already assigns `data.source_url`/`data.source_type` straight through.

- [ ] **Step 3: Hide the "Source" link when there's no `sourceUrl`**

In `src/app/pages/RecipeDetailPage.tsx`, change:

```tsx
          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            Source <ExternalLink className="size-4" />
          </a>
```

to:

```tsx
          {recipe.sourceUrl && (
            <a
              href={recipe.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Source <ExternalLink className="size-4" />
            </a>
          )}
```

- [ ] **Step 4: Type-check and run the existing suite**

Run: `npm run build`
Expected: succeeds with no TypeScript errors

Run: `npm test`
Expected: PASS (existing Vitest suite, unchanged — this task adds no new test file; the "Source" link's absence is verified end-to-end by Task 6/7's Playwright specs, which save a recipe with `sourceUrl: null` and assert the link doesn't render)

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/types.ts src/app/lib/recipesApi.ts src/app/pages/RecipeDetailPage.tsx
git commit -m "feat: allow recipes with no source URL (photo/text imports)"
```

---

### Task 5: Client-side image resize/compress utility

**Files:**
- Create: `src/app/lib/imageResize.ts`
- Create: `src/app/lib/imageResize.test.ts`

**Interfaces:**
- Produces: `export function computeResizedDimensions(width: number, height: number, maxDimension: number): { width: number; height: number }` (pure, unit-tested); `export interface CompressedImage { mediaType: string; data: string }`; `export async function compressImageFile(file: File, maxDimension?: number, quality?: number): Promise<CompressedImage>` (uses the DOM canvas API — not unit-testable under Vitest's jsdom environment without adding a new canvas-mocking dependency, which is out of scope; it's verified visually in Task 8's manual Playwright pass and functionally in Task 7's e2e test). `CompressedImage` matches the backend's `ImageInput` shape from Task 3 (`{ mediaType: string; data: string }`), consumed by Task 7's `ImportPage.tsx`.

- [ ] **Step 1: Write the failing tests for `computeResizedDimensions`**

```typescript
// src/app/lib/imageResize.test.ts
import { describe, it, expect } from 'vitest'
import { computeResizedDimensions } from './imageResize'

describe('computeResizedDimensions', () => {
  it('leaves an image unchanged when both dimensions are within the max', () => {
    expect(computeResizedDimensions(300, 200, 1500)).toEqual({ width: 300, height: 200 })
  })

  it('leaves an image unchanged when both dimensions equal the max', () => {
    expect(computeResizedDimensions(1500, 1500, 1500)).toEqual({ width: 1500, height: 1500 })
  })

  it('scales down proportionally when width is the larger dimension', () => {
    expect(computeResizedDimensions(3000, 1500, 1500)).toEqual({ width: 1500, height: 750 })
  })

  it('scales down proportionally when height is the larger dimension', () => {
    expect(computeResizedDimensions(1200, 3000, 1500)).toEqual({ width: 600, height: 1500 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- imageResize`
Expected: FAIL with "computeResizedDimensions is not defined" (or a module-not-found error) — `src/app/lib/imageResize.ts` doesn't exist yet

- [ ] **Step 3: Write `imageResize.ts`**

```typescript
// src/app/lib/imageResize.ts
export interface CompressedImage {
  mediaType: string
  data: string
}

export function computeResizedDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) return { width, height }
  const scale = maxDimension / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export async function compressImageFile(
  file: File,
  maxDimension = 1500,
  quality = 0.8,
): Promise<CompressedImage> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Failed to load photo'))
      img.src = objectUrl
    })

    const { width, height } = computeResizedDimensions(image.naturalWidth, image.naturalHeight, maxDimension)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not supported in this browser')
    ctx.drawImage(image, 0, 0, width, height)

    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    const base64 = dataUrl.split(',')[1]
    return { mediaType: 'image/jpeg', data: base64 }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- imageResize`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/imageResize.ts src/app/lib/imageResize.test.ts
git commit -m "feat: add client-side image resize/compress utility"
```

---

### Task 6: ImportPage — tabbed mode selector with paste-text import

**Files:**
- Modify: `src/app/pages/ImportPage.tsx`
- Create: `e2e/import-paste-text.spec.ts`

**Interfaces:**
- Consumes: `saveRecipe`/`SaveRecipeInput` (Task 4), `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` from `../components/ui/tabs` (existing, unmodified).
- Produces: the `From URL` / `Paste Text` tabbed UI Task 7 extends with a third `Take Photos` tab.

- [ ] **Step 1: Rewrite `ImportPage.tsx` with a tabbed mode selector**

```tsx
// src/app/pages/ImportPage.tsx
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
```

- [ ] **Step 2: Write the paste-text e2e test**

```typescript
// e2e/import-paste-text.spec.ts
import { test, expect } from '@playwright/test'
import { signInAsNewUser } from './helpers/auth'

test('paste recipe text, review, and save it without a source link', async ({ page }) => {
  const { cleanup } = await signInAsNewUser(page)
  try {
    await page.goto('/import')
    await page.getByRole('tab', { name: 'Paste Text' }).click()
    await page
      .getByPlaceholder('Paste the recipe text here')
      .fill('Three-Second Soup\n1 can tomatoes\nStir.\nServe.')
    await page.getByRole('button', { name: 'Extract recipe from text' }).click()

    // The import edge function isn't deployed in this environment, so this
    // exercises the graceful failure path, same as the existing URL-import test.
    await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible()
    await page.screenshot({ path: 'screenshot/import-paste-text-review.png' })

    await page.locator('input').first().fill('Pasted Soup')
    await page.locator('textarea').nth(0).fill('1 can tomatoes')
    await page.locator('textarea').nth(1).fill('Stir.\nServe.')
    await page.getByRole('button', { name: 'Save recipe' }).click()

    await expect(page).toHaveURL(/\/recipe\/[\w-]+$/)
    await expect(page.getByRole('heading', { name: 'Pasted Soup' })).toBeVisible()
    // Pasted-text imports have no source URL, so the "Source" link must not render.
    await expect(page.getByRole('link', { name: /^Source/ })).toHaveCount(0)
    await page.screenshot({ path: 'screenshot/import-paste-text-detail.png' })
  } finally {
    await cleanup()
  }
})
```

- [ ] **Step 3: Run the frontend unit suite and typecheck**

Run: `npm run build`
Expected: succeeds with no TypeScript errors

Run: `npm test`
Expected: PASS (unchanged from Task 4/5)

- [ ] **Step 4: Run the new e2e test**

Run: `npm run test:e2e -- import-paste-text.spec.ts`
Expected: PASS. Note: this requires `screenshot/` to exist as a directory at the repo root — create it (e.g. `mkdir -p screenshot`) before running if it doesn't already exist; Playwright's `page.screenshot({ path })` does not create missing parent directories.

Note: this test's final assertions (successful save with a null `sourceUrl`) require Task 1's migration to have been applied to the hosted project. If Task 1's migration hasn't been pushed yet, this test will fail at the `Save recipe` step with a NOT NULL constraint violation — that failure is expected and resolves once Task 1's migration is applied; do not attempt to work around it by making `source_url` non-null client-side.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/ImportPage.tsx e2e/import-paste-text.spec.ts
git commit -m "feat: add paste-text tab to the import page"
```

---

### Task 7: ImportPage — camera photo capture tab

**Files:**
- Modify: `src/app/pages/ImportPage.tsx`
- Create: `e2e/import-photo.spec.ts`
- Create: `e2e/fixtures/recipe-photo.png`

**Interfaces:**
- Consumes: `compressImageFile`, `type CompressedImage` from `../lib/imageResize` (Task 5).

- [ ] **Step 1: Create the fixture image used by the e2e test**

```bash
node -e "require('fs').writeFileSync('e2e/fixtures/recipe-photo.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'))"
```

This writes a minimal valid 1×1 transparent PNG to `e2e/fixtures/recipe-photo.png`. It's a real image (Chromium can decode and canvas-draw it), so `compressImageFile` re-encodes it to JPEG without error; the recipe content is irrelevant since this test exercises the failure path (see Step 3).

- [ ] **Step 2: Add the `Take Photos` tab to `ImportPage.tsx`**

Apply these changes to `src/app/pages/ImportPage.tsx` from Task 6:

1. Update the imports:

```tsx
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { saveRecipe } from '../lib/recipesApi'
import type { RecipeDraft } from '../lib/types'
import { compressImageFile, type CompressedImage } from '../lib/imageResize'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
```

2. Widen the mode/source types and the request body union — including `SourceType`, defined in Task 6 as `'web' | 'youtube' | 'text'`, which must widen to include `'photo'` since `setSourceType(data.sourceType)` now receives that value from the images path:

```tsx
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
```

3. Add state and handlers inside the component, alongside the existing `useState` calls:

```tsx
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<StagedPhoto[]>([])
  const [isCompressing, setIsCompressing] = useState(false)

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
    try {
      const newPhotos = await Promise.all(
        filesToAdd.map(async (file) => ({
          previewUrl: URL.createObjectURL(file),
          compressed: await compressImageFile(file),
        })),
      )
      setPhotos((current) => [...current, ...newPhotos])
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
```

4. In `handleSave`, `sourceUrl: mode === 'url' ? url : null` already covers `'photos'` and `'text'` correctly (Task 6) — no change needed there.

5. Add the third tab to the `TabsList`/`Tabs` block from Task 6:

```tsx
            <TabsList className="w-full">
              <TabsTrigger value="url" className="flex-1">From URL</TabsTrigger>
              <TabsTrigger value="photos" className="flex-1">Take Photos</TabsTrigger>
              <TabsTrigger value="text" className="flex-1">Paste Text</TabsTrigger>
            </TabsList>
```

6. Add the new `TabsContent` panel (between the `url` and `text` panels from Task 6):

```tsx
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
                    <img src={photo.previewUrl} alt={`Recipe photo ${index + 1}`} className="size-20 object-cover rounded-md" />
                    <button
                      type="button"
                      aria-label={`Remove photo ${index + 1}`}
                      onClick={() => handleRemovePhoto(index)}
                      className="absolute -top-2 -right-2 flex items-center justify-center size-5 rounded-full bg-destructive text-white text-xs"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleAddPhotoClick}
                disabled={photos.length >= MAX_PHOTOS || isCompressing}
              >
                {isCompressing ? 'Processing…' : 'Add photo'}
              </Button>
              <form onSubmit={handlePhotosSubmit}>
                <Button type="submit" className="w-full" disabled={photos.length === 0 || status === 'importing'}>
                  {status === 'importing' ? 'Extracting…' : 'Extract recipe from photos'}
                </Button>
              </form>
            </TabsContent>
```

- [ ] **Step 3: Write the photo e2e test**

```typescript
// e2e/import-photo.spec.ts
import path from 'path'
import { test, expect } from '@playwright/test'
import { signInAsNewUser } from './helpers/auth'

test('take photos of a recipe, review, and save it without a source link', async ({ page }) => {
  const { cleanup } = await signInAsNewUser(page)
  try {
    await page.goto('/import')
    await page.getByRole('tab', { name: 'Take Photos' }).click()
    await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, 'fixtures', 'recipe-photo.png'))
    await expect(page.getByRole('button', { name: /^Remove photo/ })).toHaveCount(1)

    await page.getByRole('button', { name: 'Extract recipe from photos' }).click()

    // The import edge function isn't deployed in this environment, so this
    // exercises the graceful failure path, same as the other import tests.
    await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible()
    await page.screenshot({ path: 'screenshot/import-photo-review.png' })

    await page.locator('input').first().fill('Photographed Soup')
    await page.locator('textarea').nth(0).fill('1 can tomatoes')
    await page.locator('textarea').nth(1).fill('Stir.\nServe.')
    await page.getByRole('button', { name: 'Save recipe' }).click()

    await expect(page).toHaveURL(/\/recipe\/[\w-]+$/)
    await expect(page.getByRole('heading', { name: 'Photographed Soup' })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Source/ })).toHaveCount(0)
    await page.screenshot({ path: 'screenshot/import-photo-detail.png' })
  } finally {
    await cleanup()
  }
})
```

- [ ] **Step 4: Run the frontend unit suite and typecheck**

Run: `npm run build`
Expected: succeeds with no TypeScript errors

Run: `npm test`
Expected: PASS (unchanged)

- [ ] **Step 5: Run both new e2e tests plus the existing import e2e test**

Run: `npm run test:e2e -- import-photo.spec.ts import-paste-text.spec.ts import-and-cook.spec.ts`
Expected: PASS. Same Task 1 migration caveat as Task 6 applies here too.

- [ ] **Step 6: Commit**

```bash
git add src/app/pages/ImportPage.tsx e2e/import-photo.spec.ts e2e/fixtures/recipe-photo.png
git commit -m "feat: add camera photo capture tab to the import page"
```

---

### Task 8: Manual visual verification

**Files:** none (verification only — produces screenshots under `screenshot/`)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (leave running)

- [ ] **Step 2: Sign in and navigate to Import**

Using a real or test account, sign in, then navigate to `/import`.

- [ ] **Step 3: Screenshot each of the three tabs in their idle state**

Capture and save:
- `screenshot/manual-tab-url.png` — the `From URL` tab active
- `screenshot/manual-tab-photos.png` — the `Take Photos` tab active, before adding any photo
- `screenshot/manual-tab-text.png` — the `Paste Text` tab active

- [ ] **Step 4: Screenshot the photo tab with photos staged**

On the `Take Photos` tab, add at least one photo (a real camera capture if testing on a phone, or any image file if testing on desktop) and capture `screenshot/manual-photos-staged.png` showing the thumbnail strip and remove buttons.

- [ ] **Step 5: Screenshot the review screen reached from paste-text**

Paste some recipe text, submit, and capture `screenshot/manual-review-from-text.png`.

- [ ] **Step 6: Screenshot a saved recipe's detail page with no Source link**

Save the reviewed draft, then on the resulting `/recipe/:id` page, capture `screenshot/manual-recipe-detail-no-source-link.png`, confirming visually that no "Source" link appears in the top-right corner (unlike a URL-imported recipe).

- [ ] **Step 7: Report**

Report the list of files saved under `screenshot/` as the completed proof.
