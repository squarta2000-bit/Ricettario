# Ricettario — Design Spec

Date: 2026-08-28
Status: Approved for planning

## 1. Objective

A private web app to manage cooking recipes. Users import recipes from a URL (web page or YouTube video) and the system extracts ingredients (with quantity/weight) and preparation steps, estimating a duration per step. A "Start cooking" mode runs an auto-advancing timer through the steps. The home page lists saved recipes with title, total estimated duration, and complexity (when the source provided one). Each user has their own private recipe workspace.

## 2. Scope for this iteration

- Web recipe import (via schema.org markup, or LLM extraction as fallback)
- YouTube video import (via captions/transcript + LLM extraction)
- Instagram/Facebook reel import is explicitly **out of scope** for this iteration — no official transcript API exists for either platform, and reliable extraction would require fragile scraping or audio transcription. Revisit as a future phase if still wanted.
- Per-user private workspaces, email-OTP login, open signup
- Review/edit step before an imported recipe is saved
- Auto-advancing cooking-mode timer with manual pause/skip/back
- Full test coverage: unit, integration (mocked LLM), Playwright E2E, and screenshot-based visual verification for UI changes

## 3. Constraints & priorities

- **Private, non-commercial use.** No subscription/billing to build. Cost-consciousness on LLM API spend is a first-class design constraint, not an afterthought.
- LLM calls are billed pay-as-you-go against the developer's **personal** Anthropic account (a separate API key from any Claude Code account used during development), stored only as a Supabase Edge Function secret.
- Existing scaffold to build on: React 18 + Vite + Tailwind v4 + shadcn/Radix UI components, Supabase JS client, a Supabase Edge Function (Hono on Deno), and a generic `kv_store_a36e056a` key-value table (to be replaced by a real relational schema).

## 4. Architecture overview

```
┌─────────────────────────┐
│  React SPA (Vite)       │  Home (recipe list) · Login (OTP)
│  shadcn/Radix UI        │  Import flow · Review/edit screen
│                          │  Recipe detail · Cooking mode (timer)
└───────────┬──────────────┘
            │ supabase-js (auth + direct table reads/writes)
            ▼
┌─────────────────────────┐
│  Supabase Postgres       │  recipes, ingredients, steps
│  + Auth (email OTP)      │  Row-level security: owner_id = auth.uid()
│  + Row Level Security    │  → each user sees only their own recipes
└───────────┬──────────────┘
            │ used only for the import pipeline
            ▼
┌─────────────────────────┐
│ Supabase Edge Function   │  1. Fetch URL / YouTube captions
│ (Hono, Deno) — "import"  │  2. Try schema.org JSON-LD parse (free, no LLM)
│                          │  3. Fallback: Claude Haiku 4.5 structured extraction
│                          │  4. Enforce per-user daily import rate limit
│                          │  5. Return structured draft to client (not yet saved)
└───────────┬──────────────┘
            │ only when JSON-LD is absent/incomplete
            ▼
      Anthropic API (Claude Haiku 4.5)
```

The edge function is stateless and only touched at **import time**. Browsing recipes, opening a recipe, and running cooking mode are plain authenticated Postgres reads via `supabase-js` — no LLM or edge function involvement, so day-to-day use has no marginal LLM cost.

## 5. Data model

```sql
recipes
  id                    uuid primary key
  owner_id              uuid not null references auth.users
  title                 text not null
  source_url            text not null
  source_type           text not null  -- 'web' | 'youtube'
  image_url             text           -- thumbnail, if the source provides one
  complexity            text           -- stored as-extracted (e.g. "Easy", "3/5") — only
                                        -- shown if the original recipe had one; no forced enum
  servings              text           -- kept as-extracted (units vary too much to normalize)
  created_at            timestamptz default now()

ingredients
  id                    uuid primary key
  recipe_id             uuid references recipes(id) on delete cascade
  position              int not null       -- display order
  raw_text              text not null      -- original line, always kept as a fallback
  quantity              numeric            -- nullable — not everything parses cleanly
  unit                  text               -- nullable
  name                  text not null

steps
  id                    uuid primary key
  recipe_id             uuid references recipes(id) on delete cascade
  position              int not null       -- 1-indexed order; also the cooking-mode sequence
  instruction           text not null
  estimated_minutes     numeric            -- nullable; missing → manual-only in cooking mode
```

Notes:
- **Total estimated duration** (home page list) is `sum(steps.estimated_minutes)` computed at query time — no denormalized column; at this data volume there's no reason to accept a sync-on-write bug class for the sake of a trivial read optimization.
- **Complexity/servings are free text**, not normalized enums — sources express these inconsistently, and the requirement is "show it if the source showed it," not cross-recipe comparison.
- **RLS**: every table's select/insert/update/delete policy checks `auth.uid() = owner_id` (via the parent `recipes` row for `ingredients`/`steps`) — each user only ever sees their own data. This is Supabase's standard per-user isolation pattern.
- **`ingredients.raw_text`** is a deliberate hedge against imperfect LLM extraction — even if quantity/unit parsing fails, the original line is never lost, and the review screen shows it alongside the parsed fields.

## 6. Extraction pipeline

**Web URL path** (`POST /import` on the edge function):
1. Fetch the target URL server-side (avoids CORS; keeps the API key server-side).
2. Look for `schema.org/Recipe` JSON-LD or microdata — most recipe blogs embed this for SEO.
3. If found and complete (has ingredients + instructions) → map directly to the draft object. **Zero LLM calls.**
4. If missing or incomplete → strip the HTML to plain visible text (drop scripts/styles/nav/footer, keep the main content region), then call **Claude Haiku 4.5** with a strict JSON schema (`output_config.format`) matching the draft shape: title, ingredients[], steps[] with `estimated_minutes`, complexity, servings. The strict schema means the response is parsed as structured data, never regex'd out of free text.

**YouTube path**: extract the video ID, pull the caption track via YouTube's public timed-text endpoint (free, no API quota; unofficial and could change — acceptable risk for a personal project). Feed the transcript plus title/description to Haiku 4.5 with the same extraction schema. There's no JSON-LD equivalent for video, so this path always calls the LLM.

**Either path** returns a draft JSON to the client — nothing is written to the database at this point. The client shows the draft in the review/edit screen; only on explicit save does the client write directly to `recipes`/`ingredients`/`steps` via `supabase-js`. The edge function is not involved in saving.

**Rate limiting**: because signup is open, the edge function counts each user's `recipes` rows created in the last 24h and rejects new imports past a threshold (default 20/day) before calling the LLM — protects the developer's personal API key from abuse without requiring an invite system.

**Failure handling**: if the fetch fails (bot-blocked site, 404, captions disabled) the edge function returns a clear error and the review screen still opens with an empty form — manual entry is always the fallback; import never hard-blocks adding a recipe.

**Cost note**: a typical extraction call (a few thousand input tokens, under ~1,000 output tokens) costs roughly $0.01 on Haiku 4.5. Combined with the JSON-LD fast path (which needs no LLM call for most recipe blogs) and the rate limit above, expected LLM spend for personal use is a few cents to a few dollars total over the app's lifetime.

## 7. Authentication

Supabase Auth, **email OTP** (one-time code or magic link — no password to set, remember, or reset). **Signup is open**: any email can request a code and get their own workspace. Session persistence is handled automatically by `supabase-js` (localStorage) — no custom session code needed.

## 8. Cooking-mode timer engine

Pure client-side state machine; no backend involvement once a recipe's steps are loaded.

- **State**: `currentStepIndex`, `stepStartedAt`, `isPaused`, `elapsedBeforePause`.
- **Auto-advance**: a 1s-tick interval compares elapsed time against `steps[currentStepIndex].estimated_minutes`; on expiry, fires an alert (sound + visual) and advances to the next step, resetting the per-step clock.
- **Manual override**: Pause/Resume freezes the clock; Skip forward / Back jump `currentStepIndex` directly and reset that step's timer — each step's timer is independent, so no schedule recalculation is needed.
- **Completion**: after the last step's time elapses (or the user manually advances past it), show a "Done cooking" end state.
- **Missing-time edge case**: a step with no `estimated_minutes` (extraction gap) is manual-only — no auto-advance; the user taps "Next" themselves.

## 9. Frontend structure

```
/                    Home — recipe list (title, total duration, complexity if present) + Sign In
/login               Email entry → OTP sent → code/link confirms → redirect to /
/recipe/:id          Recipe detail — full ingredients/steps, source link top-right, "Start cooking"
/recipe/:id/cook     Cooking-mode timer view
/import              URL/YouTube input → review/edit draft → save
```

Auth-gated: everything except `/login` requires a session; unauthenticated visits redirect to `/login`.

## 10. Testing strategy

**Unit tests (Vitest)**:
- JSON-LD → draft mapping logic
- HTML-to-text stripping used for the LLM-fallback input
- Timer state machine as pure functions (elapsed time + steps → current step/remaining time), decoupled from React
- Rate-limit counter logic

**Integration tests (edge function)**:
- Fixtures: one page with complete JSON-LD (should skip the LLM entirely), one with none (triggers the Haiku fallback), one YouTube URL with a canned transcript fixture.
- The Anthropic call is **mocked/stubbed** in all automated tests — never hit the real API from the test suite, to keep tests free and deterministic.

**E2E tests (Playwright, Chrome)**:
- OTP sign-in flow, using Supabase local dev's Inbucket test mailbox to read the code/link (no real email needed)
- Import with JSON-LD present → review screen → save → appears on home list
- Import without JSON-LD (mocked LLM response) → review → save
- YouTube import → review → save
- Start cooking → verify auto-advance at step boundaries (test recipe uses short, e.g. few-second, step durations) → pause/resume/skip/back controls
- Sign out and session persistence across reload

**Visual verification**: for every new/changed screen (login, home, import/review, recipe detail, cooking mode), take a Playwright screenshot and check it against the intended layout before considering that piece done.

## 11. Explicitly deferred (not this iteration)

- Instagram/Facebook reel import
- Password-based login / password reset
- Invite-only signup restriction (open signup chosen instead, mitigated by the per-user rate limit)
- Recipe tags/categories, search/filter on the home page
- Denormalized/cached total-duration column
