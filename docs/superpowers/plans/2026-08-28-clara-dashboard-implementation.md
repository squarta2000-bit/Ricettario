# Clara Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private recipe-management web app: import recipes from a URL or YouTube video, review/edit the extracted ingredients and steps, save them, and run a "Start cooking" mode with an auto-advancing per-step timer.

**Architecture:** React SPA (existing Vite/Tailwind/shadcn scaffold) talking directly to Supabase Postgres (via `supabase-js`, RLS-scoped per user) for all browsing/editing/cooking. A single Supabase Edge Function (Hono/Deno) handles import-time extraction only: schema.org JSON-LD parsing first, falling back to a Claude Haiku 4.5 structured-extraction call when JSON-LD is absent — nothing else in the app ever touches the LLM.

**Tech Stack:** React 18.3.1, Vite 6.3.5, Tailwind 4.1.12, shadcn/Radix UI (already scaffolded), `@supabase/supabase-js` 2, Supabase Edge Functions (Hono on Deno), Anthropic TypeScript SDK (`claude-haiku-4-5`), Vitest (new, for pure-logic unit tests), Deno's built-in test runner (edge function integration tests), Playwright (new, E2E + visual screenshots), `react-router-dom` (new, client routing).

**Spec:** `docs/superpowers/specs/2026-08-28-clara-dashboard-design.md`

## Global Constraints

- Private, non-commercial, cost-conscious: the LLM is called **only** from the import edge function, **only** when JSON-LD extraction fails, using model `claude-haiku-4-5` — never a different model, never from any other code path.
- **Never call the real Anthropic API or the real network from an automated test.** Every test that exercises extraction logic injects a fake client/fetch function. This is non-negotiable — it's the difference between a free test suite and one that costs money and flakes on network conditions.
- Existing scaffold must be reused, not replaced: `src/app/components/ui/*` (shadcn components), `src/app/App.tsx`, `utils/supabase/info.tsx` (project ID/anon key), `supabase/functions/server/index.ts` (Hono app), `supabase/config.toml`.
- Every table (`recipes`, `ingredients`, `steps`) is private per user: RLS policies key off `auth.uid() = owner_id` (via the parent recipe for the child tables). No cross-user reads, ever.
- Auth is email OTP only — no password fields, no password-reset flow.
- Signup is open (any email can create a workspace), mitigated by a 20-imports-per-24h-per-user limit enforced server-side before any LLM call.
- Video import is YouTube-only. Instagram/Facebook are explicitly out of scope — do not add code paths for them.
- Unit tests are written **only** for the four pure-logic areas the spec calls out: JSON-LD → draft mapping, HTML-to-text stripping, the cooking timer state machine, and the rate-limit decision function. Everything else is covered by edge-function integration tests (fixtures + a fake LLM client), Playwright E2E, and screenshot visual checks — don't invent extra unit tests for UI components.

---

## Phase A: Foundation (schema, types, auth, routing)

Nothing else in the app can be built or tested until a user can exist, log in, and have a database to read/write.

### Task 1: Database schema and RLS policies

**Files:**
- Create: `supabase/migrations/0001_recipes_schema.sql`

**Interfaces:**
- Produces: tables `recipes(id, owner_id, title, source_url, source_type, image_url, complexity, servings, created_at)`, `ingredients(id, recipe_id, position, raw_text, quantity, unit, name)`, `steps(id, recipe_id, position, instruction, estimated_minutes)`, all with RLS enabled and owner-scoped policies. Every later task that touches the database depends on these exact column names.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0001_recipes_schema.sql
create table recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_url text not null,
  source_type text not null check (source_type in ('web', 'youtube')),
  image_url text,
  complexity text,
  servings text,
  created_at timestamptz not null default now()
);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position int not null,
  raw_text text not null,
  quantity numeric,
  unit text,
  name text not null
);

create table steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position int not null,
  instruction text not null,
  estimated_minutes numeric
);

create index ingredients_recipe_id_idx on ingredients(recipe_id);
create index steps_recipe_id_idx on steps(recipe_id);
create index recipes_owner_id_created_at_idx on recipes(owner_id, created_at desc);

alter table recipes enable row level security;
alter table ingredients enable row level security;
alter table steps enable row level security;

create policy "owner_full_access_recipes" on recipes
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "owner_full_access_ingredients" on ingredients
  for all using (
    auth.uid() = (select owner_id from recipes where recipes.id = ingredients.recipe_id)
  ) with check (
    auth.uid() = (select owner_id from recipes where recipes.id = ingredients.recipe_id)
  );

create policy "owner_full_access_steps" on steps
  for all using (
    auth.uid() = (select owner_id from recipes where recipes.id = steps.recipe_id)
  ) with check (
    auth.uid() = (select owner_id from recipes where recipes.id = steps.recipe_id)
  );
```

- [ ] **Step 2: Apply the migration locally and verify**

Run: `supabase start` (if not already running), then `supabase db reset`
Expected: migration applies with no errors; `supabase db reset` output lists `0001_recipes_schema.sql` as applied.

- [ ] **Step 3: Verify RLS blocks cross-user access**

Run this against the local Postgres instance (via `supabase db` psql shell or the Supabase Studio SQL editor at the local Studio URL printed by `supabase start`):

```sql
-- create two fake users directly for this check
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.com');

insert into recipes (owner_id, title, source_url, source_type)
values ('11111111-1111-1111-1111-111111111111', 'A''s Soup', 'https://example.com', 'web');

set role authenticated;
set request.jwt.claims.sub to '22222222-2222-2222-2222-222222222222';
select count(*) from recipes; -- expect 0, not 1
reset role;
```

Expected: the count is `0` — user B cannot see user A's recipe.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_recipes_schema.sql
git commit -m "feat: add recipes/ingredients/steps schema with per-user RLS"
```

---

### Task 2: Frontend shared types and Supabase client

**Files:**
- Create: `src/app/lib/types.ts`
- Create: `src/app/lib/supabaseClient.ts`

**Interfaces:**
- Consumes: `projectId`, `publicAnonKey` from `utils/supabase/info.tsx` (already exists).
- Produces: `Recipe`, `RecipeWithDetails`, `RecipeListItem`, `Ingredient`, `Step` types; `RecipeDraft` type (the shape returned by the import edge function); a singleton `supabase` client. Every later frontend task imports from these two files.

- [ ] **Step 1: Write the shared types**

```typescript
// src/app/lib/types.ts
export interface Ingredient {
  id: string
  recipeId: string
  position: number
  rawText: string
  quantity: number | null
  unit: string | null
  name: string
}

export interface Step {
  id: string
  recipeId: string
  position: number
  instruction: string
  estimatedMinutes: number | null
}

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

export interface RecipeWithDetails extends Recipe {
  ingredients: Ingredient[]
  steps: Step[]
}

export interface RecipeListItem {
  id: string
  title: string
  complexity: string | null
  totalMinutes: number | null
}

// Mirrors supabase/functions/server/extraction/types.ts — the edge function's
// response shape. Duplicated (not imported) because the edge function runs on
// Deno and the frontend on Vite/Node; keep the two in sync by hand.
export interface RecipeDraftIngredient {
  rawText: string
  quantity: number | null
  unit: string | null
  name: string
}

export interface RecipeDraftStep {
  instruction: string
  estimatedMinutes: number | null
}

export interface RecipeDraft {
  title: string
  complexity: string | null
  servings: string | null
  imageUrl: string | null
  ingredients: RecipeDraftIngredient[]
  steps: RecipeDraftStep[]
}
```

- [ ] **Step 2: Write the Supabase client singleton**

```typescript
// src/app/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js'
import { projectId, publicAnonKey } from '../../../utils/supabase/info'

export const supabase = createClient(`https://${projectId}.supabase.co`, publicAnonKey)
```

- [ ] **Step 3: Verify the project still builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors (these files aren't used anywhere yet, but must type-check cleanly).

- [ ] **Step 4: Commit**

```bash
git add src/app/lib/types.ts src/app/lib/supabaseClient.ts
git commit -m "feat: add shared recipe types and Supabase client singleton"
```

---

### Task 3: Auth (email OTP) and route guard

**Files:**
- Create: `src/app/lib/authContext.tsx`
- Create: `src/app/pages/LoginPage.tsx`
- Create: `src/app/components/RequireAuth.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `supabase` from `src/app/lib/supabaseClient.ts`; `Button`, `Input` from `src/app/components/ui/*`.
- Produces: `AuthProvider`, `useAuth(): { session: Session | null, isLoading: boolean }`, `<RequireAuth>` wrapper component. Later tasks (Home, Recipe detail, Import, Cooking mode) all render inside `<RequireAuth>` and may call `useAuth()` to get the current user id.

- [ ] **Step 1: Add the routing dependency**

Run: `npm install react-router-dom`
Expected: `package.json` gains `react-router-dom` under `dependencies`.

- [ ] **Step 2: Write the auth context**

```typescript
// src/app/lib/authContext.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

interface AuthContextValue {
  session: Session | null
  isLoading: boolean
}

const AuthContext = createContext<AuthContextValue>({ session: null, isLoading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setIsLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={{ session, isLoading }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
```

- [ ] **Step 3: Write the login page**

```tsx
// src/app/pages/LoginPage.tsx
import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setStatus('sending')
    const { error } = await supabase.auth.signInWithOtp({ email })
    setStatus(error ? 'error' : 'sent')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 px-4">
        <h1 className="text-2xl font-normal text-center">Ricettario</h1>
        {status === 'sent' ? (
          <p className="text-center text-muted-foreground">
            Check your email for a sign-in link.
          </p>
        ) : (
          <>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Button type="submit" className="w-full" disabled={status === 'sending'}>
              Sign in
            </Button>
            {status === 'error' && (
              <p className="text-center text-destructive text-sm">
                Something went wrong. Please try again.
              </p>
            )}
          </>
        )}
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Write the route guard**

```tsx
// src/app/components/RequireAuth.tsx
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/authContext'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuth()
  if (isLoading) return null
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
```

- [ ] **Step 5: Wire routing into App.tsx**

```tsx
// src/app/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/authContext'
import { RequireAuth } from './components/RequireAuth'
import { Toaster } from './components/ui/sonner'
import LoginPage from './pages/LoginPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <div className="min-h-screen bg-background">
                  <div className="max-w-7xl mx-auto px-4 py-8 text-center text-muted-foreground py-16">
                    <p className="text-xl mb-2">No recipes yet</p>
                    <p>Home page comes in Task 5.</p>
                  </div>
                </div>
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </AuthProvider>
  )
}
```

- [ ] **Step 6: Manually verify against local Supabase**

Run: `supabase start` (Inbucket test mailbox runs at the URL printed in the output, typically `http://localhost:54324`), then `npm run dev`.
Expected: visiting `/` redirects to `/login`; submitting an email shows "Check your email"; opening Inbucket shows the OTP email; clicking its link redirects back to `/` and shows the placeholder home page instead of redirecting to login.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/app/lib/authContext.tsx src/app/pages/LoginPage.tsx src/app/components/RequireAuth.tsx src/app/App.tsx
git commit -m "feat: add email OTP auth and route guard"
```

---

## Phase A: Acceptance Criteria

- [ ] `supabase db reset` applies the migration cleanly on a fresh local database.
- [ ] A user with no session visiting any route lands on `/login`.
- [ ] Submitting an email on `/login` sends a real OTP email visible in the local Inbucket mailbox.
- [ ] Clicking the OTP link signs the user in and lands them on `/`.
- [ ] A second, different user cannot see the first user's recipes (verified in Task 1 Step 3; re-verified informally once real data exists in Phase B).

## Phase A: Rollback & Edge Cases

- **Migration fails partway (e.g. name collision with an existing table).** `supabase db reset` replays every migration from scratch against a disposable local database, so there is no partial-apply state to roll back — fix the SQL file and re-run `supabase db reset`. On the *hosted* project, apply via `supabase db push` only after local verification; if it fails there, `supabase migration repair` or a follow-up corrective migration is the safe path — never hand-edit hosted schema.
- **User closes the OTP email/link and tries again.** Supabase OTP codes/links expire (default ~1h) and are single-use; requesting a new one simply invalidates the old one. No special handling needed — this is Supabase's default behavior.
- **`RequireAuth` renders before the session is known.** Handled by the `isLoading` check rendering nothing rather than prematurely redirecting to `/login` on a page reload where a valid session exists but hasn't loaded yet.

---

## Phase B: Recipe browsing (list, detail)

Depends on Phase A. Builds the data-access layer and the two read-heavy pages. No import pipeline yet — verify against manually-inserted rows.

### Task 4: Recipes data-access layer

**Files:**
- Create: `src/app/lib/recipesApi.ts`
- Create: `src/app/lib/recipesApi.test.ts`
- Modify: `package.json` (add Vitest)

**Interfaces:**
- Consumes: `supabase` from `supabaseClient.ts`; `Recipe`, `RecipeWithDetails`, `RecipeListItem` from `types.ts`.
- Produces: `listRecipes(): Promise<RecipeListItem[]>`, `getRecipe(id: string): Promise<RecipeWithDetails>`, `saveRecipe(input: SaveRecipeInput): Promise<string>`. The Home page (Task 5), Recipe detail page (Task 6), and Import page (Task 15) all call these exact functions.

- [ ] **Step 1: Add Vitest**

Run: `npm install -D vitest`
Add to `package.json` scripts: `"test": "vitest run"`.
Expected: `npm run test` runs (with zero test files, it reports "no tests found" — that's expected until Step 2 exists).

- [ ] **Step 2: Write a failing test for the list→total-minutes mapping**

This is the one piece of `recipesApi.ts` with real logic worth unit-testing in isolation (summing step minutes into a total); the Supabase calls themselves are thin I/O covered by manual/E2E verification, per the Global Constraints test-scope rule.

```typescript
// src/app/lib/recipesApi.test.ts
import { describe, it, expect } from 'vitest'
import { sumStepMinutes } from './recipesApi'

describe('sumStepMinutes', () => {
  it('sums estimated minutes across steps', () => {
    expect(sumStepMinutes([{ estimated_minutes: 5 }, { estimated_minutes: 10 }])).toBe(15)
  })

  it('returns null when every step is missing a time', () => {
    expect(sumStepMinutes([{ estimated_minutes: null }, { estimated_minutes: null }])).toBeNull()
  })

  it('sums the steps that do have a time and ignores the ones that do not', () => {
    expect(sumStepMinutes([{ estimated_minutes: 5 }, { estimated_minutes: null }])).toBe(5)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- recipesApi.test.ts`
Expected: FAIL — `sumStepMinutes` is not exported from `./recipesApi` (module doesn't exist yet).

- [ ] **Step 4: Write recipesApi.ts**

```typescript
// src/app/lib/recipesApi.ts
import { supabase } from './supabaseClient'
import type { RecipeListItem, RecipeWithDetails } from './types'

export function sumStepMinutes(steps: { estimated_minutes: number | null }[]): number | null {
  const known = steps.filter((s) => s.estimated_minutes != null)
  if (known.length === 0) return null
  return known.reduce((sum, s) => sum + (s.estimated_minutes as number), 0)
}

export async function listRecipes(): Promise<RecipeListItem[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select('id, title, complexity, steps(estimated_minutes)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    complexity: row.complexity,
    totalMinutes: sumStepMinutes(row.steps),
  }))
}

export async function getRecipe(id: string): Promise<RecipeWithDetails> {
  const { data, error } = await supabase
    .from('recipes')
    .select('*, ingredients(*), steps(*)')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return {
    id: data.id,
    ownerId: data.owner_id,
    title: data.title,
    sourceUrl: data.source_url,
    sourceType: data.source_type,
    imageUrl: data.image_url,
    complexity: data.complexity,
    servings: data.servings,
    createdAt: data.created_at,
    ingredients: [...data.ingredients]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        id: i.id,
        recipeId: i.recipe_id,
        position: i.position,
        rawText: i.raw_text,
        quantity: i.quantity,
        unit: i.unit,
        name: i.name,
      })),
    steps: [...data.steps]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        recipeId: s.recipe_id,
        position: s.position,
        instruction: s.instruction,
        estimatedMinutes: s.estimated_minutes,
      })),
  }
}

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

export async function saveRecipe(input: SaveRecipeInput): Promise<string> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Not signed in')

  const { data: recipe, error: recipeError } = await supabase
    .from('recipes')
    .insert({
      owner_id: userData.user.id,
      title: input.title,
      source_url: input.sourceUrl,
      source_type: input.sourceType,
      image_url: input.imageUrl,
      complexity: input.complexity,
      servings: input.servings,
    })
    .select('id')
    .single()
  if (recipeError) throw new Error(recipeError.message)

  const ingredientRows = input.ingredients.map((ing, index) => ({
    recipe_id: recipe.id,
    position: index,
    raw_text: ing.rawText,
    quantity: ing.quantity,
    unit: ing.unit,
    name: ing.name,
  }))
  const stepRows = input.steps.map((step, index) => ({
    recipe_id: recipe.id,
    position: index,
    instruction: step.instruction,
    estimated_minutes: step.estimatedMinutes,
  }))

  const [ingredientsResult, stepsResult] = await Promise.all([
    supabase.from('ingredients').insert(ingredientRows),
    supabase.from('steps').insert(stepRows),
  ])
  if (ingredientsResult.error) throw new Error(ingredientsResult.error.message)
  if (stepsResult.error) throw new Error(stepsResult.error.message)

  return recipe.id as string
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- recipesApi.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/app/lib/recipesApi.ts src/app/lib/recipesApi.test.ts
git commit -m "feat: add recipes data-access layer with tested duration summing"
```

---

### Task 5: Home page (recipe list)

**Files:**
- Create: `src/app/pages/HomePage.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `listRecipes()` from `recipesApi.ts`; `Card` from `components/ui/card`; `Button` from `components/ui/button`.
- Produces: the `/` route content. Links each recipe row to `/recipe/:id` (built in Task 6) and a "Sign out" action, and a link to `/import` (built in Task 15) — those routes don't exist yet, so the links are inert until later tasks, which is expected at this point.

- [ ] **Step 1: Write the Home page**

```tsx
// src/app/pages/HomePage.tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listRecipes } from '../lib/recipesApi'
import { supabase } from '../lib/supabaseClient'
import type { RecipeListItem } from '../lib/types'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'

export default function HomePage() {
  const [recipes, setRecipes] = useState<RecipeListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    listRecipes()
      .then(setRecipes)
      .finally(() => setIsLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-normal">Ricettario</h1>
          <div className="flex gap-2">
            <Button asChild>
              <Link to="/import">Import recipe</Link>
            </Button>
            <Button variant="outline" onClick={() => supabase.auth.signOut()}>
              Sign out
            </Button>
          </div>
        </div>

        {!isLoading && recipes.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-xl mb-2">No recipes yet</p>
            <p>Import your first recipe from a URL or YouTube video.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((recipe) => (
            <Link key={recipe.id} to={`/recipe/${recipe.id}`}>
              <Card className="p-4 h-full hover:bg-accent transition-colors">
                <h2 className="font-medium mb-1">{recipe.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {recipe.totalMinutes != null ? `${recipe.totalMinutes} min` : 'Time unknown'}
                  {recipe.complexity ? ` · ${recipe.complexity}` : ''}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into App.tsx**

Replace the inline placeholder `element` on the `/` route in `src/app/App.tsx` with `<RequireAuth><HomePage /></RequireAuth>`, and add the import:

```tsx
import HomePage from './pages/HomePage'
// ...
<Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
```

- [ ] **Step 3: Manually verify with a seeded row**

Insert one row by hand via Supabase Studio (local, from `supabase start`) into `recipes` (with your signed-in user's `id` as `owner_id`) and matching `steps` rows, then reload `/`.
Expected: the card shows the title, summed duration, and complexity (if set); an unauthenticated visit still redirects to `/login`.

- [ ] **Step 4: Commit**

```bash
git add src/app/pages/HomePage.tsx src/app/App.tsx
git commit -m "feat: add home page recipe list"
```

---

### Task 6: Recipe detail page

**Files:**
- Create: `src/app/pages/RecipeDetailPage.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `getRecipe(id)` from `recipesApi.ts`.
- Produces: the `/recipe/:id` route. Includes a "Start cooking" link to `/recipe/:id/cook` (built in Task 8) and a top-right link to `sourceUrl` — both required by the spec.

- [ ] **Step 1: Write the Recipe detail page**

```tsx
// src/app/pages/RecipeDetailPage.tsx
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { getRecipe } from '../lib/recipesApi'
import type { RecipeWithDetails } from '../lib/types'
import { Button } from '../components/ui/button'

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [recipe, setRecipe] = useState<RecipeWithDetails | null>(null)

  useEffect(() => {
    if (id) getRecipe(id).then(setRecipe)
  }, [id])

  if (!recipe) return null

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-normal">{recipe.title}</h1>
            {recipe.complexity && (
              <p className="text-sm text-muted-foreground">{recipe.complexity}</p>
            )}
          </div>
          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            Source <ExternalLink className="size-4" />
          </a>
        </div>

        <Button asChild className="mb-8">
          <Link to={`/recipe/${recipe.id}/cook`}>Start cooking</Link>
        </Button>

        <h2 className="font-medium mb-2">Ingredients</h2>
        <ul className="mb-8 space-y-1">
          {recipe.ingredients.map((ing) => (
            <li key={ing.id} className="text-sm">
              {ing.quantity != null ? `${ing.quantity} ${ing.unit ?? ''} ` : ''}
              {ing.name}
            </li>
          ))}
        </ul>

        <h2 className="font-medium mb-2">Steps</h2>
        <ol className="space-y-3 list-decimal list-inside">
          {recipe.steps.map((step) => (
            <li key={step.id} className="text-sm">
              {step.instruction}
              {step.estimatedMinutes != null && (
                <span className="text-muted-foreground"> ({step.estimatedMinutes} min)</span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into App.tsx**

```tsx
import RecipeDetailPage from './pages/RecipeDetailPage'
// ...
<Route path="/recipe/:id" element={<RequireAuth><RecipeDetailPage /></RequireAuth>} />
```

- [ ] **Step 3: Manually verify**

Click a recipe card from the home page.
Expected: full ingredient/step list renders, the source link opens the original URL in a new tab, "Start cooking" is present (its target route doesn't exist until Task 8 — a 404/blank page there is expected for now).

- [ ] **Step 4: Commit**

```bash
git add src/app/pages/RecipeDetailPage.tsx src/app/App.tsx
git commit -m "feat: add recipe detail page"
```

---

## Phase B: Acceptance Criteria

- [ ] `npm run test` passes (`sumStepMinutes` unit tests).
- [ ] A signed-in user with a seeded recipe sees it on `/`, with correct summed duration and complexity.
- [ ] Clicking a recipe opens `/recipe/:id` showing all ingredients (with raw quantity/unit where present) and all steps in order, with a working source link.
- [ ] A user with zero recipes sees the empty state, not an error.

## Phase B: Rollback & Edge Cases

- **`listRecipes`/`getRecipe` throw (RLS denies, network drop, malformed row).** Both currently propagate the thrown error to the caller uncaught in the UI — acceptable for this phase since Phase B only needs manual verification; Task 15 (import) and the Phase F polish pass are where user-facing error states get added. Note this explicitly so it isn't mistaken for done.
- **A recipe has zero steps (bad data, e.g. from a manual DB edit).** `sumStepMinutes([])` returns `null` (the `known.length === 0` branch), so the home page shows "Time unknown" rather than "0 min" or crashing.
- **A recipe has steps but none have a time.** Same `null` path — verified by the second unit test in Task 4.

---

## Phase C: Cooking mode

Depends on Phase B (needs a recipe's steps to operate on). The timer engine is pure and gets its own thorough unit tests per the Global Constraints.

### Task 7: Cooking timer engine (pure state machine)

**Files:**
- Create: `src/app/lib/timerEngine.ts`
- Create: `src/app/lib/timerEngine.test.ts`

**Interfaces:**
- Produces: `TimerState`, `TimerStep`, `startTimer(nowMs)`, `elapsedMsForCurrentStep(state, nowMs)`, `shouldAutoAdvance(state, steps, nowMs)`, `advanceStep(state, steps, nowMs)`, `goToStep(state, index, steps, nowMs)`, `pauseTimer(state, nowMs)`, `resumeTimer(state, nowMs)`. Task 8 (Cooking mode page) drives its UI entirely through these functions — it does not reimplement any timing logic itself.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/lib/timerEngine.test.ts
import { describe, it, expect } from 'vitest'
import {
  startTimer,
  elapsedMsForCurrentStep,
  shouldAutoAdvance,
  advanceStep,
  goToStep,
  pauseTimer,
  resumeTimer,
  type TimerStep,
} from './timerEngine'

const steps: TimerStep[] = [{ estimatedMinutes: 2 }, { estimatedMinutes: 6 }, { estimatedMinutes: null }]

describe('timerEngine', () => {
  it('starts at step 0 with zero elapsed time', () => {
    const state = startTimer(1000)
    expect(state.currentStepIndex).toBe(0)
    expect(elapsedMsForCurrentStep(state, 1000)).toBe(0)
  })

  it('tracks elapsed time as it runs', () => {
    const state = startTimer(1000)
    expect(elapsedMsForCurrentStep(state, 1000 + 30_000)).toBe(30_000)
  })

  it('does not auto-advance before the step time elapses', () => {
    const state = startTimer(0)
    expect(shouldAutoAdvance(state, steps, 1 * 60_000)).toBe(false)
  })

  it('auto-advances once the step time elapses', () => {
    const state = startTimer(0)
    expect(shouldAutoAdvance(state, steps, 2 * 60_000)).toBe(true)
  })

  it('never auto-advances a step with no estimated time', () => {
    const state = { ...startTimer(0), currentStepIndex: 2 }
    expect(shouldAutoAdvance(state, steps, 999 * 60_000)).toBe(false)
  })

  it('advanceStep moves to the next step and resets its clock', () => {
    const state = startTimer(0)
    const next = advanceStep(state, steps, 5000)
    expect(next.currentStepIndex).toBe(1)
    expect(elapsedMsForCurrentStep(next, 5000)).toBe(0)
  })

  it('advanceStep marks done instead of overrunning past the last step', () => {
    const state = { ...startTimer(0), currentStepIndex: 2 }
    const next = advanceStep(state, steps, 5000)
    expect(next.isDone).toBe(true)
    expect(next.currentStepIndex).toBe(2)
  })

  it('goToStep jumps directly and resets isDone', () => {
    const state = { ...startTimer(0), currentStepIndex: 2, isDone: true }
    const next = goToStep(state, 0, steps, 5000)
    expect(next.currentStepIndex).toBe(0)
    expect(next.isDone).toBe(false)
  })

  it('goToStep clamps out-of-range indexes', () => {
    const state = startTimer(0)
    expect(goToStep(state, 99, steps, 0).currentStepIndex).toBe(steps.length - 1)
    expect(goToStep(state, -5, steps, 0).currentStepIndex).toBe(0)
  })

  it('pause freezes elapsed time and resume continues it', () => {
    let state = startTimer(0)
    state = pauseTimer(state, 10_000)
    expect(elapsedMsForCurrentStep(state, 999_999)).toBe(10_000)
    state = resumeTimer(state, 20_000)
    expect(elapsedMsForCurrentStep(state, 25_000)).toBe(15_000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- timerEngine.test.ts`
Expected: FAIL — `./timerEngine` doesn't exist yet.

- [ ] **Step 3: Implement the timer engine**

```typescript
// src/app/lib/timerEngine.ts
export interface TimerStep {
  estimatedMinutes: number | null
}

export interface TimerState {
  currentStepIndex: number
  stepStartedAtMs: number
  isPaused: boolean
  elapsedBeforePauseMs: number
  isDone: boolean
}

export function startTimer(nowMs: number): TimerState {
  return { currentStepIndex: 0, stepStartedAtMs: nowMs, isPaused: false, elapsedBeforePauseMs: 0, isDone: false }
}

export function elapsedMsForCurrentStep(state: TimerState, nowMs: number): number {
  if (state.isPaused) return state.elapsedBeforePauseMs
  return state.elapsedBeforePauseMs + (nowMs - state.stepStartedAtMs)
}

export function shouldAutoAdvance(state: TimerState, steps: TimerStep[], nowMs: number): boolean {
  if (state.isDone) return false
  const step = steps[state.currentStepIndex]
  if (!step || step.estimatedMinutes == null) return false
  return elapsedMsForCurrentStep(state, nowMs) >= step.estimatedMinutes * 60_000
}

export function advanceStep(state: TimerState, steps: TimerStep[], nowMs: number): TimerState {
  if (state.currentStepIndex >= steps.length - 1) {
    return { ...state, isDone: true }
  }
  return {
    currentStepIndex: state.currentStepIndex + 1,
    stepStartedAtMs: nowMs,
    isPaused: false,
    elapsedBeforePauseMs: 0,
    isDone: false,
  }
}

export function goToStep(state: TimerState, index: number, steps: TimerStep[], nowMs: number): TimerState {
  const clamped = Math.max(0, Math.min(index, steps.length - 1))
  return { currentStepIndex: clamped, stepStartedAtMs: nowMs, isPaused: false, elapsedBeforePauseMs: 0, isDone: false }
}

export function pauseTimer(state: TimerState, nowMs: number): TimerState {
  if (state.isPaused) return state
  return { ...state, isPaused: true, elapsedBeforePauseMs: elapsedMsForCurrentStep(state, nowMs) }
}

export function resumeTimer(state: TimerState, nowMs: number): TimerState {
  if (!state.isPaused) return state
  return { ...state, isPaused: false, stepStartedAtMs: nowMs }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- timerEngine.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/timerEngine.ts src/app/lib/timerEngine.test.ts
git commit -m "feat: add cooking timer state machine with full unit coverage"
```

---

### Task 8: Cooking mode page

**Files:**
- Create: `src/app/pages/CookingModePage.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `getRecipe(id)` from `recipesApi.ts`; every function from `timerEngine.ts` (Task 7).
- Produces: the `/recipe/:id/cook` route.

- [ ] **Step 1: Write the Cooking mode page**

```tsx
// src/app/pages/CookingModePage.tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getRecipe } from '../lib/recipesApi'
import {
  startTimer,
  advanceStep,
  goToStep,
  pauseTimer,
  resumeTimer,
  shouldAutoAdvance,
  elapsedMsForCurrentStep,
  type TimerState,
} from '../lib/timerEngine'
import type { RecipeWithDetails } from '../lib/types'
import { Button } from '../components/ui/button'

export default function CookingModePage() {
  const { id } = useParams<{ id: string }>()
  const [recipe, setRecipe] = useState<RecipeWithDetails | null>(null)
  const [timer, setTimer] = useState<TimerState | null>(null)
  const [, forceTick] = useState(0)
  const alertedStepRef = useRef<number | null>(null)

  useEffect(() => {
    if (id) getRecipe(id).then((r) => {
      setRecipe(r)
      setTimer(startTimer(Date.now()))
    })
  }, [id])

  useEffect(() => {
    if (!recipe || !timer) return
    const interval = setInterval(() => {
      const now = Date.now()
      setTimer((current) => {
        if (!current) return current
        if (shouldAutoAdvance(current, recipe.steps, now) && alertedStepRef.current !== current.currentStepIndex) {
          alertedStepRef.current = current.currentStepIndex
          return advanceStep(current, recipe.steps, now)
        }
        return current
      })
      forceTick((t) => t + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [recipe, timer])

  if (!recipe || !timer) return null

  const step = recipe.steps[timer.currentStepIndex]
  const elapsedSeconds = Math.floor(elapsedMsForCurrentStep(timer, Date.now()) / 1000)
  const remainingSeconds = step.estimatedMinutes != null ? Math.max(0, step.estimatedMinutes * 60 - elapsedSeconds) : null

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="max-w-xl w-full px-4 text-center">
        {timer.isDone ? (
          <>
            <h1 className="text-2xl font-normal mb-4">Done cooking!</h1>
            <Button asChild>
              <Link to={`/recipe/${recipe.id}`}>Back to recipe</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-2">
              Step {timer.currentStepIndex + 1} of {recipe.steps.length}
            </p>
            <p className="text-xl mb-4">{step.instruction}</p>
            {remainingSeconds != null && (
              <p className="text-4xl font-mono mb-6">
                {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')}
              </p>
            )}
            <div className="flex gap-2 justify-center">
              <Button
                variant="outline"
                onClick={() => setTimer(goToStep(timer, timer.currentStepIndex - 1, recipe.steps, Date.now()))}
                disabled={timer.currentStepIndex === 0}
              >
                Back
              </Button>
              <Button
                variant="outline"
                onClick={() => setTimer(timer.isPaused ? resumeTimer(timer, Date.now()) : pauseTimer(timer, Date.now()))}
              >
                {timer.isPaused ? 'Resume' : 'Pause'}
              </Button>
              <Button onClick={() => setTimer(advanceStep(timer, recipe.steps, Date.now()))}>
                Next step
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into App.tsx**

```tsx
import CookingModePage from './pages/CookingModePage'
// ...
<Route path="/recipe/:id/cook" element={<RequireAuth><CookingModePage /></RequireAuth>} />
```

- [ ] **Step 3: Manually verify**

On a seeded recipe, edit its steps to have `estimated_minutes` of `0.05` (3 seconds) via Supabase Studio, then click "Start cooking".
Expected: the countdown ticks down and auto-advances to the next step at zero; Pause freezes the countdown; Back/Next move between steps; reaching the end shows "Done cooking!".

- [ ] **Step 4: Commit**

```bash
git add src/app/pages/CookingModePage.tsx src/app/App.tsx
git commit -m "feat: add cooking mode page driven by the timer engine"
```

---

## Phase C: Acceptance Criteria

- [ ] `npm run test` passes all `timerEngine.test.ts` cases (10 tests from Task 7).
- [ ] Starting cooking mode on a real recipe shows step 1 immediately with a running countdown.
- [ ] A step's timer expiring auto-advances to the next step exactly once (not repeatedly re-triggering).
- [ ] Pause/Resume/Back/Next all behave correctly against a running timer.
- [ ] Finishing the last step shows the "Done cooking" end state, and it does not re-trigger `advanceStep` past the last index.

## Phase C: Rollback & Edge Cases

- **A step has `estimated_minutes: null` (extraction gap).** `shouldAutoAdvance` returns `false` for it unconditionally (unit-tested in Task 7) — the UI shows no countdown for that step and the user must tap "Next step" manually, exactly per spec section 8.
- **User leaves the tab in the background and returns later.** Because `elapsedMsForCurrentStep` is computed from wall-clock timestamps (`stepStartedAtMs`) rather than a decrementing counter, elapsed time is always correct on return — there's no drift from throttled background timers to correct for.
- **Double-firing of auto-advance in the same tick.** Guarded by `alertedStepRef` in the page component, which only allows one auto-advance per step index per mount.

---

## Phase D: Import extraction pipeline (edge function)

Depends on Phase A (auth — the route needs a signed-in user) and Task 1's schema (rate limiting queries `recipes`). Independent of Phase B/C otherwise; could be built in parallel with them, but is sequenced after because Task 15 (Import UI) needs both this phase and `saveRecipe` from Task 4.

### Task 9: Draft types and schema.org JSON-LD parser

**Files:**
- Create: `supabase/functions/server/extraction/types.ts`
- Create: `supabase/functions/server/extraction/jsonld.ts`
- Create: `supabase/functions/server/extraction/jsonld.test.ts`

**Interfaces:**
- Produces: `RecipeDraft` type (Deno-side twin of the frontend's, see Task 2); `findRecipeJsonLd(html: string): SchemaOrgRecipe | null`; `jsonLdToDraft(recipe: SchemaOrgRecipe): RecipeDraft | null`. Task 14 (import route) calls both in sequence to attempt the zero-LLM-cost path first.

- [ ] **Step 1: Write the draft type**

```typescript
// supabase/functions/server/extraction/types.ts
export interface RecipeDraft {
  title: string
  complexity: string | null
  servings: string | null
  imageUrl: string | null
  ingredients: { rawText: string; quantity: number | null; unit: string | null; name: string }[]
  steps: { instruction: string; estimatedMinutes: number | null }[]
}
```

- [ ] **Step 2: Write the failing tests**

```typescript
// supabase/functions/server/extraction/jsonld.test.ts
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findRecipeJsonLd, jsonLdToDraft } from "./jsonld.ts";

const HTML_WITH_RECIPE = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Tomato Soup",
  "recipeYield": "4 servings",
  "totalTime": "PT30M",
  "recipeIngredient": ["2 cans tomatoes", "1 onion"],
  "recipeInstructions": [
    { "@type": "HowToStep", "text": "Chop the onion." },
    { "@type": "HowToStep", "text": "Simmer everything for 20 minutes." }
  ]
}
</script>
</head><body></body></html>
`;

const HTML_WITHOUT_RECIPE = `<html><body><p>Just a blog post, no recipe markup.</p></body></html>`;

Deno.test("findRecipeJsonLd finds a Recipe block among other JSON-LD", () => {
  const recipe = findRecipeJsonLd(HTML_WITH_RECIPE);
  assertExists(recipe);
  assertEquals(recipe?.name, "Tomato Soup");
});

Deno.test("findRecipeJsonLd returns null when there is no Recipe block", () => {
  assertEquals(findRecipeJsonLd(HTML_WITHOUT_RECIPE), null);
});

Deno.test("jsonLdToDraft maps ingredients, steps, servings, and splits totalTime evenly", () => {
  const recipe = findRecipeJsonLd(HTML_WITH_RECIPE);
  const draft = jsonLdToDraft(recipe!);
  assertExists(draft);
  assertEquals(draft?.title, "Tomato Soup");
  assertEquals(draft?.servings, "4 servings");
  assertEquals(draft?.ingredients.length, 2);
  assertEquals(draft?.steps.length, 2);
  assertEquals(draft?.steps[0].estimatedMinutes, 15); // 30 min / 2 steps
});

Deno.test("jsonLdToDraft returns null when ingredients or instructions are missing", () => {
  const draft = jsonLdToDraft({ "@type": "Recipe", name: "Empty" });
  assertEquals(draft, null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `deno test supabase/functions/server/extraction/jsonld.test.ts`
Expected: FAIL — `./jsonld.ts` doesn't exist yet.

- [ ] **Step 4: Implement the JSON-LD parser**

```typescript
// supabase/functions/server/extraction/jsonld.ts
import type { RecipeDraft } from "./types.ts";

interface SchemaOrgRecipe {
  "@type"?: string | string[];
  name?: string;
  recipeIngredient?: string[];
  recipeInstructions?: unknown;
  totalTime?: string;
  recipeYield?: string | string[];
  image?: string | { url?: string } | string[];
}

function isRecipeType(type: string | string[] | undefined): boolean {
  if (!type) return false;
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => t.toLowerCase() === "recipe");
}

function extractInstructionText(instructions: unknown): string[] {
  if (!instructions) return [];
  if (typeof instructions === "string") {
    return instructions.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(instructions)) {
    return instructions
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in (item as Record<string, unknown>)) {
          return String((item as { text: unknown }).text);
        }
        return "";
      })
      .filter(Boolean);
  }
  return [];
}

function parseIsoDurationToMinutes(iso: string | undefined): number | null {
  if (!iso) return null;
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const total = days * 24 * 60 + hours * 60 + minutes;
  return total > 0 ? total : null;
}

export function findRecipeJsonLd(html: string): SchemaOrgRecipe | null {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const graph = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] ?? [])];
      for (const candidate of graph) {
        if (candidate && isRecipeType(candidate["@type"])) {
          return candidate as SchemaOrgRecipe;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function jsonLdToDraft(recipe: SchemaOrgRecipe): RecipeDraft | null {
  const ingredients = recipe.recipeIngredient ?? [];
  const instructions = extractInstructionText(recipe.recipeInstructions);
  if (ingredients.length === 0 || instructions.length === 0) return null;

  const totalMinutes = parseIsoDurationToMinutes(recipe.totalTime);
  const perStepMinutes = totalMinutes ? Math.max(1, Math.round(totalMinutes / instructions.length)) : null;

  let imageUrl: string | null = null;
  if (typeof recipe.image === "string") imageUrl = recipe.image;
  else if (Array.isArray(recipe.image) && typeof recipe.image[0] === "string") imageUrl = recipe.image[0];
  else if (recipe.image && typeof recipe.image === "object" && "url" in recipe.image) {
    imageUrl = (recipe.image as { url?: string }).url ?? null;
  }

  return {
    title: recipe.name ?? "Untitled recipe",
    complexity: null,
    servings: Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] ?? null : recipe.recipeYield ?? null,
    imageUrl,
    ingredients: ingredients.map((raw) => ({ rawText: raw, quantity: null, unit: null, name: raw })),
    steps: instructions.map((instruction) => ({ instruction, estimatedMinutes: perStepMinutes })),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test supabase/functions/server/extraction/jsonld.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/server/extraction/types.ts supabase/functions/server/extraction/jsonld.ts supabase/functions/server/extraction/jsonld.test.ts
git commit -m "feat: add schema.org JSON-LD recipe parser (zero-LLM-cost path)"
```

---

### Task 10: HTML-to-text stripper

**Files:**
- Create: `supabase/functions/server/extraction/htmlToText.ts`
- Create: `supabase/functions/server/extraction/htmlToText.test.ts`

**Interfaces:**
- Produces: `htmlToVisibleText(html: string): string`. Task 14 calls this to prepare the LLM-fallback input whenever `jsonLdToDraft` returns `null`.

- [ ] **Step 1: Write the failing tests**

```typescript
// supabase/functions/server/extraction/htmlToText.test.ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { htmlToVisibleText } from "./htmlToText.ts";

Deno.test("strips scripts, styles, and tags, keeping visible text", () => {
  const html = `
    <html><head><style>.a{color:red}</style><script>alert(1)</script></head>
    <body><nav>Home | About</nav><h1>Tomato Soup</h1><p>Chop the onion.</p><footer>© 2026</footer></body></html>
  `;
  const text = htmlToVisibleText(html);
  assertStringIncludes(text, "Tomato Soup");
  assertStringIncludes(text, "Chop the onion.");
  assertEquals(text.includes("alert(1)"), false);
  assertEquals(text.includes("color:red"), false);
  assertEquals(text.includes("Home | About"), false);
  assertEquals(text.includes("© 2026"), false);
});

Deno.test("collapses whitespace", () => {
  const text = htmlToVisibleText("<p>Hello   \n\n  world</p>");
  assertEquals(text, "Hello world");
});

Deno.test("truncates very long input", () => {
  const text = htmlToVisibleText("<p>" + "a".repeat(50_000) + "</p>");
  assertEquals(text.length <= 20_000, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/server/extraction/htmlToText.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the stripper**

```typescript
// supabase/functions/server/extraction/htmlToText.ts
export function htmlToVisibleText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ");
  const withoutTags = withoutNoise.replace(/<[^>]+>/g, " ");
  return withoutTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/server/extraction/htmlToText.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/server/extraction/htmlToText.ts supabase/functions/server/extraction/htmlToText.test.ts
git commit -m "feat: add HTML-to-visible-text stripper for LLM fallback input"
```

---

### Task 11: LLM structured extraction (Claude Haiku 4.5)

**Files:**
- Create: `supabase/functions/server/extraction/llmExtract.ts`
- Create: `supabase/functions/server/extraction/llmExtract.test.ts`

**Interfaces:**
- Consumes: `RecipeDraft` from `types.ts`.
- Produces: `extractRecipeWithLlm(sourceText: string, client: MessagesClient): Promise<RecipeDraft>`, where `MessagesClient` is a minimal injectable interface — production code passes a real `Anthropic` client, tests pass a fake. Task 14 constructs the real client and calls this.

- [ ] **Step 1: Before writing code, confirm the exact request/response shape**

Invoke the `claude-api` skill (`/claude-api`) and read its TypeScript structured-outputs section (`typescript/claude-api/README.md` / `tool-use.md`) to confirm the current `output_config.format` wire shape for `client.messages.create`. The code below is the best-effort shape as of this plan — treat the skill's live docs as authoritative and adjust the request body if they differ before considering this task done.

- [ ] **Step 2: Write the failing tests**

```typescript
// supabase/functions/server/extraction/llmExtract.test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractRecipeWithLlm, type MessagesClient } from "./llmExtract.ts";

function fakeClient(responseText: string): MessagesClient {
  return {
    messages: {
      create: async () => ({ content: [{ type: "text", text: responseText }] }),
    },
  };
}

Deno.test("parses a well-formed structured response into a RecipeDraft", async () => {
  const draft = await extractRecipeWithLlm(
    "some transcript text",
    fakeClient(
      JSON.stringify({
        title: "Tomato Soup",
        complexity: "Easy",
        servings: "4",
        ingredients: [{ rawText: "2 cans tomatoes", quantity: 2, unit: "cans", name: "tomatoes" }],
        steps: [{ instruction: "Chop the onion.", estimatedMinutes: 5 }],
      }),
    ),
  );
  assertEquals(draft.title, "Tomato Soup");
  assertEquals(draft.ingredients[0].name, "tomatoes");
  assertEquals(draft.steps[0].estimatedMinutes, 5);
});

Deno.test("throws when the model returns no text block", async () => {
  const client: MessagesClient = { messages: { create: async () => ({ content: [] }) } };
  await assertRejects(() => extractRecipeWithLlm("text", client), Error, "No structured output returned");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `deno test supabase/functions/server/extraction/llmExtract.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement the LLM extraction module**

```typescript
// supabase/functions/server/extraction/llmExtract.ts
import Anthropic from "npm:@anthropic-ai/sdk";
import type { RecipeDraft } from "./types.ts";

export interface MessagesClient {
  messages: {
    create(params: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

const DRAFT_SCHEMA = {
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

export async function extractRecipeWithLlm(sourceText: string, client: MessagesClient): Promise<RecipeDraft> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
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

  const textBlock = response.content.find((block) => block.type === "text" && block.text);
  if (!textBlock?.text) throw new Error("No structured output returned");
  return JSON.parse(textBlock.text) as RecipeDraft;
}

export function createAnthropicMessagesClient(apiKey: string): MessagesClient {
  return new Anthropic({ apiKey });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test supabase/functions/server/extraction/llmExtract.test.ts`
Expected: PASS (2 tests). If `output_config.format` differs from the skill's live docs (Step 1), adjust `DRAFT_SCHEMA`'s wrapping and re-run before moving on.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/server/extraction/llmExtract.ts supabase/functions/server/extraction/llmExtract.test.ts
git commit -m "feat: add Claude Haiku 4.5 structured recipe extraction (client injectable for tests)"
```

---

### Task 12: YouTube transcript fetcher

**Files:**
- Create: `supabase/functions/server/extraction/youtubeTranscript.ts`
- Create: `supabase/functions/server/extraction/youtubeTranscript.test.ts`

**Interfaces:**
- Produces: `extractYoutubeVideoId(url: string): string | null`; `fetchYoutubeTranscript(videoId: string, fetchFn: typeof fetch): Promise<string>`. Task 14 uses `extractYoutubeVideoId` to decide web-vs-YouTube routing, and calls `fetchYoutubeTranscript` (with the real global `fetch`) when it's a YouTube URL.

- [ ] **Step 1: Write the failing tests**

```typescript
// supabase/functions/server/extraction/youtubeTranscript.test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractYoutubeVideoId, fetchYoutubeTranscript } from "./youtubeTranscript.ts";

Deno.test("extracts the video id from common YouTube URL shapes", () => {
  assertEquals(extractYoutubeVideoId("https://www.youtube.com/watch?v=abcdefghijk"), "abcdefghijk");
  assertEquals(extractYoutubeVideoId("https://youtu.be/abcdefghijk"), "abcdefghijk");
  assertEquals(extractYoutubeVideoId("https://www.youtube.com/shorts/abcdefghijk"), "abcdefghijk");
  assertEquals(extractYoutubeVideoId("https://example.com/not-youtube"), null);
});

function fakeFetch(listXml: string, trackXml: string): typeof fetch {
  return (async (url: string | URL) => {
    const isListRequest = String(url).includes("type=list");
    return new Response(isListRequest ? listXml : trackXml);
  }) as typeof fetch;
}

Deno.test("fetches and joins transcript lines for the first available language", async () => {
  const listXml = `<transcript_list><track lang_code="en"/></transcript_list>`;
  const trackXml = `<transcript><text>Chop the onion.</text><text>Simmer for 20 minutes.</text></transcript>`;
  const transcript = await fetchYoutubeTranscript("abcdefghijk", fakeFetch(listXml, trackXml));
  assertEquals(transcript, "Chop the onion. Simmer for 20 minutes.");
});

Deno.test("throws when no captions are available", async () => {
  await assertRejects(
    () => fetchYoutubeTranscript("abcdefghijk", fakeFetch("<transcript_list></transcript_list>", "")),
    Error,
    "No captions available",
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/server/extraction/youtubeTranscript.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the transcript fetcher**

```typescript
// supabase/functions/server/extraction/youtubeTranscript.ts
export function extractYoutubeVideoId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(url);
    if (match) return match[1];
  }
  return null;
}

export async function fetchYoutubeTranscript(videoId: string, fetchFn: typeof fetch): Promise<string> {
  const listResponse = await fetchFn(`https://video.google.com/timedtext?type=list&v=${videoId}`);
  const listXml = await listResponse.text();
  const langMatch = /lang_code="([^"]+)"/.exec(listXml);
  if (!langMatch) throw new Error("No captions available for this video");

  const trackResponse = await fetchFn(`https://video.google.com/timedtext?lang=${langMatch[1]}&v=${videoId}`);
  const trackXml = await trackResponse.text();
  const lines = [...trackXml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
    m[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim()
  );
  if (lines.length === 0) throw new Error("Transcript was empty");
  return lines.join(" ");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/server/extraction/youtubeTranscript.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/server/extraction/youtubeTranscript.ts supabase/functions/server/extraction/youtubeTranscript.test.ts
git commit -m "feat: add YouTube video-id parsing and transcript fetcher"
```

---

### Task 13: Per-user daily import rate limit

**Files:**
- Create: `supabase/functions/server/rateLimit.ts`
- Create: `supabase/functions/server/rateLimit.test.ts`

**Interfaces:**
- Produces: `DAILY_IMPORT_LIMIT` (20); `hasImportCapacity(recentImportCount: number): boolean` (pure, unit-tested); `countRecentImports(supabaseUrl: string, serviceRoleKey: string, userId: string): Promise<number>` (thin I/O wrapper, not unit-tested — covered by the Task 14 integration test). Task 14 calls `countRecentImports` then `hasImportCapacity` before doing any extraction work.

- [ ] **Step 1: Write the failing test for the pure decision function**

```typescript
// supabase/functions/server/rateLimit.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasImportCapacity, DAILY_IMPORT_LIMIT } from "./rateLimit.ts";

Deno.test("allows imports below the daily limit", () => {
  assertEquals(hasImportCapacity(0), true);
  assertEquals(hasImportCapacity(DAILY_IMPORT_LIMIT - 1), true);
});

Deno.test("blocks imports at or above the daily limit", () => {
  assertEquals(hasImportCapacity(DAILY_IMPORT_LIMIT), false);
  assertEquals(hasImportCapacity(DAILY_IMPORT_LIMIT + 5), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/server/rateLimit.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement rate limiting**

```typescript
// supabase/functions/server/rateLimit.ts
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

export const DAILY_IMPORT_LIMIT = 20;

export function hasImportCapacity(recentImportCount: number): boolean {
  return recentImportCount < DAILY_IMPORT_LIMIT;
}

export async function countRecentImports(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
): Promise<number> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("recipes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId)
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/server/rateLimit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/server/rateLimit.ts supabase/functions/server/rateLimit.test.ts
git commit -m "feat: add per-user daily import rate limit (pure decision function tested)"
```

---

### Task 14: `/import` route (wires everything together)

**Files:**
- Create: `supabase/functions/server/routes/import.ts`
- Create: `supabase/functions/server/routes/import.test.ts`
- Modify: `supabase/functions/server/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 9–13 (`findRecipeJsonLd`, `jsonLdToDraft`, `htmlToVisibleText`, `extractRecipeWithLlm`, `createAnthropicMessagesClient`, `extractYoutubeVideoId`, `fetchYoutubeTranscript`, `countRecentImports`, `hasImportCapacity`).
- Produces: `POST /server/import` — request `{ url: string }` with an `Authorization: Bearer <access_token>` header; response `{ draft: RecipeDraft, sourceType: 'web' | 'youtube' }` on success, or `{ error: string }` with a 401/429/502 status. Task 15 (Import UI) is the sole caller.

- [ ] **Step 1: Write the failing integration tests**

These use a real local HTTP server for fixture HTML (so the route's real `fetch(url)` call exercises real network code against known content) and a fake `MessagesClient` (so no real Anthropic call ever happens), per the Global Constraints.

```typescript
// supabase/functions/server/routes/import.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildImportApp } from "./import.ts";
import type { MessagesClient } from "../extraction/llmExtract.ts";

function fakeLlmClient(draftJson: Record<string, unknown>): MessagesClient {
  return { messages: { create: async () => ({ content: [{ type: "text", text: JSON.stringify(draftJson) }] }) } };
}

async function withFixtureServer(html: string, run: (url: string) => Promise<void>) {
  const server = Deno.serve({ port: 0 }, () => new Response(html, { headers: { "content-type": "text/html" } }));
  const port = (server.addr as Deno.NetAddr).port;
  try {
    await run(`http://localhost:${port}/`);
  } finally {
    await server.shutdown();
  }
}

const JSONLD_HTML = `<script type="application/ld+json">{"@type":"Recipe","name":"Soup","recipeIngredient":["Tomatoes"],"recipeInstructions":["Simmer."]}</script>`;
const PLAIN_HTML = `<html><body><h1>Soup</h1><p>Simmer the tomatoes for ten minutes.</p></body></html>`;

Deno.test("returns 401 when there is no Authorization header", async () => {
  const app = buildImportApp({
    getUserId: async () => null,
    fetchYoutubeTranscript: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
  });
  const response = await app.request("/server/import", { method: "POST", body: JSON.stringify({ url: "https://x.test" }) });
  assertEquals(response.status, 401);
});

Deno.test("returns 429 when the daily import limit is reached", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 20,
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ url: "https://x.test" }),
  });
  assertEquals(response.status, 429);
});

Deno.test("uses the JSON-LD fast path without calling the LLM", async () => {
  await withFixtureServer(JSONLD_HTML, async (url) => {
    let llmCalled = false;
    const app = buildImportApp({
      getUserId: async () => "user-1",
      fetchYoutubeTranscript: async () => "",
      llmClientFactory: () => {
        llmCalled = true;
        return fakeLlmClient({});
      },
      countRecentImports: async () => 0,
    });
    const response = await app.request("/server/import", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: JSON.stringify({ url }),
    });
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.draft.title, "Soup");
    assertEquals(llmCalled, false);
  });
});

Deno.test("falls back to the LLM when there is no JSON-LD", async () => {
  await withFixtureServer(PLAIN_HTML, async (url) => {
    const app = buildImportApp({
      getUserId: async () => "user-1",
      fetchYoutubeTranscript: async () => "",
      llmClientFactory: () =>
        fakeLlmClient({ title: "Soup", complexity: null, servings: null, ingredients: [], steps: [] }),
      countRecentImports: async () => 0,
    });
    const response = await app.request("/server/import", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: JSON.stringify({ url }),
    });
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.draft.title, "Soup");
  });
});

Deno.test("routes YouTube URLs through the transcript path", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "Chop onions. Simmer for ten minutes.",
    llmClientFactory: () =>
      fakeLlmClient({ title: "Video Soup", complexity: null, servings: null, ingredients: [], steps: [] }),
    countRecentImports: async () => 0,
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ url: "https://youtu.be/abcdefghijk" }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.sourceType, "youtube");
  assertEquals(body.draft.title, "Video Soup");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/server/routes/import.test.ts`
Expected: FAIL — `./import.ts` doesn't export `buildImportApp` yet.

- [ ] **Step 3: Implement the import route**

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
}

export function buildImportApp(deps: ImportAppDeps) {
  const app = new Hono();

  app.post("/server/import", async (c) => {
    const userId = await deps.getUserId(c.req.header("Authorization"));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const recentCount = await deps.countRecentImports(userId);
    if (!hasImportCapacity(recentCount)) {
      return c.json({ error: "Daily import limit reached" }, 429);
    }

    const { url } = await c.req.json<{ url: string }>();
    const videoId = extractYoutubeVideoId(url);

    try {
      let draft: RecipeDraft | null;
      const sourceType: "web" | "youtube" = videoId ? "youtube" : "web";

      if (videoId) {
        const transcript = await deps.fetchYoutubeTranscript(videoId);
        draft = await extractRecipeWithLlm(transcript, deps.llmClientFactory());
      } else {
        const pageResponse = await fetch(url);
        if (!pageResponse.ok) throw new Error(`Failed to fetch page: ${pageResponse.status}`);
        const html = await pageResponse.text();
        const jsonLd = findRecipeJsonLd(html);
        draft = jsonLd ? jsonLdToDraft(jsonLd) : null;
        if (!draft) {
          draft = await extractRecipeWithLlm(htmlToVisibleText(html), deps.llmClientFactory());
        }
      }

      return c.json({ draft, sourceType });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Import failed" }, 502);
    }
  });

  return app;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/server/routes/import.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the real dependencies into the deployed edge function**

```typescript
// supabase/functions/server/index.ts
import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { buildImportApp } from "./routes/import.ts";
import { fetchYoutubeTranscript } from "./extraction/youtubeTranscript.ts";
import { createAnthropicMessagesClient } from "./extraction/llmExtract.ts";
import { countRecentImports } from "./rateLimit.ts";

const app = new Hono();

app.use('*', logger(console.log));
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

app.get("/server/health", (c) => c.json({ status: "ok" }));

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY")!;

app.route(
  "/",
  buildImportApp({
    getUserId: async (authHeader) => {
      if (!authHeader) return null;
      const supabase = createClient(supabaseUrl, anonKey);
      const { data, error } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (error || !data.user) return null;
      return data.user.id;
    },
    fetchYoutubeTranscript: (videoId) => fetchYoutubeTranscript(videoId, fetch),
    llmClientFactory: () => createAnthropicMessagesClient(anthropicApiKey),
    countRecentImports: (userId) => countRecentImports(supabaseUrl, serviceRoleKey, userId),
  }),
);

Deno.serve(app.fetch);
```

- [ ] **Step 6: Set the Anthropic API key secret**

Run: `supabase secrets set ANTHROPIC_API_KEY=<your personal-account key>`
Expected: confirmation output; the key is available to the edge function as `Deno.env.get("ANTHROPIC_API_KEY")` on next deploy/restart.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/server/routes/import.ts supabase/functions/server/routes/import.test.ts supabase/functions/server/index.ts
git commit -m "feat: add /import route wiring JSON-LD, LLM fallback, YouTube, and rate limiting"
```

---

## Phase D: Acceptance Criteria

- [ ] `deno test supabase/functions/server` passes every test across Tasks 9–14 (17 tests total).
- [ ] Calling `/server/import` with a URL to a page containing valid `Recipe` JSON-LD returns a draft with zero LLM calls (verified by the "fast path" integration test).
- [ ] Calling it with a page lacking JSON-LD returns a draft built from the (faked-in-tests, real-in-prod) LLM call.
- [ ] Calling it with a YouTube URL routes through the transcript path, never the JSON-LD path.
- [ ] Calling it without a valid `Authorization` header returns 401; calling it past the daily limit returns 429 — both checked before any network fetch or LLM call happens (cost protection, not just correctness).

## Phase D: Rollback & Edge Cases

- **Target site blocks the fetch, 404s, or times out.** The route catches this and returns `502` with the underlying error message; Task 15's Import UI (still to come) must render this as a "couldn't import, want to enter it manually?" state rather than a dead end.
- **YouTube video has captions disabled.** `fetchYoutubeTranscript` throws "No captions available for this video" — surfaces as the same 502 path above.
- **LLM returns malformed JSON despite the schema constraint.** `JSON.parse` throws inside `extractRecipeWithLlm`, propagating to the route's catch block as a 502 — no partial/corrupt draft is ever returned to the client.
- **`ANTHROPIC_API_KEY` secret is missing or wrong.** The real Anthropic SDK call fails with an auth error inside the try/catch, surfacing as a 502 — never crashes the function or leaks the key value in the error message (the SDK's error objects don't echo credentials).
- **Rate limit counter query itself fails (DB hiccup).** `countRecentImports` throws (propagates the Supabase error) rather than silently treating a DB error as "0 imports so far" — a transient outage fails closed (blocks the import) rather than open (bypassing the cost guard), which is the safer default given this feature exists specifically to protect a personal API budget.
- **Reverting this phase.** Since the route is additive (a new path on the Hono app) and the schema/RLS from Phase A is unaffected, rollback is simply removing the `app.route("/", buildImportApp(...))` line and redeploying — Phase B/C continue to work unchanged against manually-entered recipes.

---

## Phase E: Import UI

Depends on Phase D (the route to call) and Task 4 (`saveRecipe` to persist the reviewed draft).

### Task 15: Import page (URL input → review/edit → save)

**Files:**
- Create: `src/app/pages/ImportPage.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `supabase` (for the access token and `functions.invoke`), `saveRecipe` from `recipesApi.ts`, `RecipeDraft` type from `types.ts`.
- Produces: the `/import` route, linked from the Home page (Task 5).

- [ ] **Step 1: Write the Import page**

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
      setErrorMessage(error?.message ?? 'Import failed. You can still fill this in manually.')
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
                    .map((line) => ({ instruction: line, estimatedMinutes: null })),
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

- [ ] **Step 2: Wire it into App.tsx**

```tsx
import ImportPage from './pages/ImportPage'
// ...
<Route path="/import" element={<RequireAuth><ImportPage /></RequireAuth>} />
```

- [ ] **Step 3: Manually verify both extraction paths**

Test with a real recipe blog URL known to embed `Recipe` JSON-LD (fast path) and a real YouTube cooking video with captions enabled (LLM path) against the local dev stack with `ANTHROPIC_API_KEY` set to a real personal-account key for this one manual check.
Expected: both produce a review screen with sensible title/ingredients/steps; editing text areas updates the draft; saving lands on the new recipe's detail page and it now appears on Home.

- [ ] **Step 4: Commit**

```bash
git add src/app/pages/ImportPage.tsx src/app/App.tsx
git commit -m "feat: add import page with review/edit before save"
```

---

## Phase E: Acceptance Criteria

- [ ] Submitting a URL with JSON-LD support shows a review screen pre-filled with the extracted title/ingredients/steps.
- [ ] Submitting a URL without JSON-LD support shows a review screen pre-filled via the LLM path.
- [ ] Submitting a YouTube URL shows a review screen pre-filled via the transcript+LLM path.
- [ ] A failed import (bad URL, blocked fetch) still opens the review screen with an empty, manually-fillable form rather than a dead end.
- [ ] Saving from the review screen creates the recipe and redirects to its detail page, which then also appears on Home.

## Phase E: Rollback & Edge Cases

- **User navigates away mid-import.** No draft has been saved to the database at any point before "Save recipe" is clicked — an abandoned import leaves no orphaned data to clean up.
- **`saveRecipe` succeeds for the recipe row but fails on ingredients/steps (partial write).** Currently not wrapped in a transaction (`supabase-js` doesn't expose multi-table transactions directly) — a future hardening step would be a single Postgres RPC function that inserts all three rows atomically. Flagging this now as a known gap rather than silently shipping it: acceptable for a personal low-volume tool, but worth revisiting if data integrity issues are ever observed.
- **Review textarea parsing loses structure (quantity/unit) on edit.** Accepted trade-off for a simple text-line editor — matches the spec's "review/edit screen" requirement without over-building a structured per-field editor; `rawText`/`name` become identical on manual edits, which is fine since `rawText` is only ever a display fallback.

---

## Phase F: End-to-end verification and visual sign-off

Depends on every prior phase being functionally complete. This phase adds no new product behavior — it proves the whole system works together and satisfies the project's testing requirements.

### Task 16: Playwright E2E suite and visual screenshots

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/auth.spec.ts`
- Create: `e2e/import-and-cook.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the running app (`npm run dev`) and local Supabase (`supabase start`, including Inbucket for OTP emails).
- Produces: an E2E suite runnable via `npx playwright test`, plus one committed screenshot per screen for visual sign-off.

- [ ] **Step 1: Add Playwright**

Run: `npm install -D @playwright/test && npx playwright install chromium`
Add to `package.json` scripts: `"test:e2e": "playwright test"`.

- [ ] **Step 2: Configure Playwright**

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
})
```

- [ ] **Step 3: Write the auth E2E test (reads the OTP from local Inbucket)**

```typescript
// e2e/auth.spec.ts
import { test, expect } from '@playwright/test'

const INBUCKET_URL = 'http://localhost:54324'

test('sign in via email OTP and sign out', async ({ page, request }) => {
  const email = `e2e-${Date.now()}@example.com`

  await page.goto('/login')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Check your email')).toBeVisible()

  const inbox = await request.get(`${INBUCKET_URL}/api/v1/mailbox/${email.split('@')[0]}`)
  const messages = await inbox.json()
  const messageDetail = await request.get(`${INBUCKET_URL}/api/v1/mailbox/${email.split('@')[0]}/${messages[0].id}`)
  const body = await messageDetail.json()
  const link = /https?:\/\/[^\s"]+/.exec(body.body.text)?.[0]
  if (!link) throw new Error('No sign-in link found in the OTP email')

  await page.goto(link)
  await expect(page).toHaveURL('/')
  await page.screenshot({ path: 'e2e/screenshots/home.png' })

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL('/login')
})
```

- [ ] **Step 4: Run the auth test to verify it passes against the real local stack**

Run: `supabase start` (if not running), `npm run dev` (separate terminal), then `npm run test:e2e -- auth.spec.ts`
Expected: PASS. Inspect `e2e/screenshots/home.png` — confirm it matches the intended Home page layout (empty-state or seeded card grid) before proceeding.

- [ ] **Step 5: Write the import-and-cook E2E test**

This test seeds a recipe directly via the app's own save path (bypassing real network import) to keep it independent of any external site being reachable during CI, then exercises the cooking-mode timer against a short-duration recipe.

```typescript
// e2e/import-and-cook.spec.ts
import { test, expect } from '@playwright/test'

test('review-and-save a manually entered recipe, then cook it', async ({ page, context }) => {
  // Assumes an already-authenticated storageState from a prior sign-in in this
  // spec file's own setup — for brevity here, reuse the sign-in flow from
  // auth.spec.ts's pattern before this block in the real implementation.
  await page.goto('/import')
  await page.getByPlaceholder('https://example.com/recipe or a YouTube URL').fill('https://nonexistent.invalid/recipe')
  await page.getByRole('button', { name: 'Import' }).click()

  // Expect the graceful failure path: review screen opens empty rather than dead-ending.
  await expect(page.getByText(/Review before saving|Import failed/)).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/import-review.png' })

  await page.getByLabel('Title').fill('Three-Second Soup')
  await page.locator('textarea').nth(0).fill('1 can tomatoes')
  await page.locator('textarea').nth(1).fill('Stir.\nServe.')
  await page.getByRole('button', { name: 'Save recipe' }).click()

  await expect(page).toHaveURL(/\/recipe\/[\w-]+$/)
  await page.screenshot({ path: 'e2e/screenshots/recipe-detail.png' })

  await page.getByRole('link', { name: 'Start cooking' }).click()
  await expect(page).toHaveURL(/\/cook$/)
  await page.screenshot({ path: 'e2e/screenshots/cooking-mode.png' })

  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
  await page.getByRole('button', { name: 'Resume' }).click()
  await page.getByRole('button', { name: 'Next step' }).click()
  await page.getByRole('button', { name: 'Next step' }).click()
  await expect(page.getByText('Done cooking!')).toBeVisible()
})
```

- [ ] **Step 6: Run the full E2E suite**

Run: `npm run test:e2e`
Expected: PASS. Review every screenshot under `e2e/screenshots/` against the design intent from the spec (Section 9's page list) before considering the UI done — this is the project's mandatory visual verification step, not optional polish.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts e2e/ package.json package-lock.json
git commit -m "test: add Playwright E2E suite covering auth, import, save, and cooking mode"
```

---

## Phase F: Acceptance Criteria

- [ ] `npm run test` (Vitest) and `deno test supabase/functions/server` (Deno) both pass with zero failures.
- [ ] `npm run test:e2e` passes end-to-end against a local Supabase stack with no manual intervention (OTP retrieved from Inbucket automatically, not typed in by a human).
- [ ] A screenshot exists for every screen listed in spec Section 9 (login, home, import/review, recipe detail, cooking mode) and each has been visually compared against the intended layout.
- [ ] The complete golden path — sign up → import (or manually enter) a recipe → see it on Home → open it → start cooking → reach "Done cooking" — works in one unbroken run.

## Phase F: Rollback & Edge Cases

- **Inbucket API shape differs from what's assumed in Task 16 Step 3.** Inbucket's REST API has changed across Supabase CLI versions; if the mailbox/message endpoints 404, check the CLI's currently-running Inbucket version's API docs (printed by `supabase status`) and adjust the two `request.get` URLs — this is a test-infrastructure detail, not a product bug.
- **E2E suite is flaky in CI due to real network calls.** By design, only Task 16's *manual* verification step (Task 15 Step 3) ever calls a real external site or the real Anthropic API — every automated E2E test either uses local fixtures/an unreachable URL (to hit the graceful-failure path deliberately) or a locally-seeded recipe. If a future test needs the real import path automated, it must inject a fixture server the same way Task 14's integration tests do, never hit the live internet or the live LLM.
- **Rolling back this phase.** Deleting `playwright.config.ts` and `e2e/` fully removes E2E coverage without touching any product code — safe to do temporarily if Playwright itself becomes a blocker, though it means losing the project's required test coverage until reinstated.

---

## Overall Rollback Strategy

Each phase's tasks commit independently and are additive (new tables, new files, new routes) rather than destructive rewrites of prior phases:

- **Phase A** can be rolled back by dropping the three tables (`drop table steps, ingredients, recipes cascade;`) and reverting the auth/routing commits — no other phase has run yet at that point.
- **Phase B/C** additions are new pages/files; reverting their commits removes the pages but leaves the schema and auth intact.
- **Phase D** is fully isolated behind the `/server/import` route — reverting Task 14's `index.ts` wiring (keep it a `git revert` of that one commit) instantly disables import without touching browsing, cooking, or auth.
- **Phase E** depends on Phase D; if Phase D is rolled back, Phase E's Import page will show the "Import failed" graceful-failure state (Task 15 Step 3's manual entry fallback) rather than breaking — this was validated as a first-class path, not an afterthought.
- **Phase F** is test-only and never needs product rollback.

If a rollback of *deployed* Supabase migrations is ever needed (not just local dev), write a new corrective migration rather than editing or deleting a previously-applied one — this matches Supabase's own migration model and avoids divergence between local and hosted schema history.
