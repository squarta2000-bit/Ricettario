import { expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Matches utils/supabase/info.tsx's projectId - this is the hosted project
// the whole app talks to (no local Supabase stack in this environment).
const SUPABASE_URL = 'https://shfalrsfypruoammidsj.supabase.co'

function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY environment variable is not set. E2E auth tests need it to call ' +
        "the Supabase Admin API (auth.admin.generateLink), which substitutes for reading a real " +
        'OTP email against this hosted project - there is no local Inbucket mailbox available here. ' +
        'Set it before running `npm run test:e2e`.',
    )
  }
  return key
}

/**
 * A service-role Supabase client, bypassing RLS. Used both for the
 * `auth.admin` calls in {@link signInAsNewUser} and by tests that need to
 * seed/mutate rows directly (e.g. setting `steps.estimated_minutes` to a
 * real short duration so the cooking-mode timer's auto-advance can be
 * exercised for real - there's no UI path to set per-step minutes, since
 * the manual-entry review screen only edits step instruction text).
 */
export function createAdminClient() {
  const serviceRoleKey = requireServiceRoleKey()
  return createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Result of {@link signInAsNewUser}: the signed-in email and a cleanup
 * handle that removes the throwaway user from the hosted project. */
export interface TestUserSession {
  email: string
  userId: string
  /**
   * Deletes the real `auth.users` row created by `generateLink` for this
   * test run. Every test that calls `signInAsNewUser` MUST call this in a
   * `finally` block - otherwise every suite run leaves another permanent,
   * throwaway user behind on the hosted project (this is a personal
   * project's own Supabase instance, not a disposable CI-only sandbox).
   * Deleting the user cascades to their recipes/ingredients/steps via the
   * `on delete cascade` FK from the schema, so no separate recipe cleanup
   * is needed.
   */
  cleanup: () => Promise<void>
}

/**
 * Establishes an authenticated session WITHOUT ever calling the real
 * `signInWithOtp` / `/auth/v1/otp` endpoint. That endpoint sends a real
 * email and is capped by Supabase's default built-in mailer at roughly
 * 2 sends/hour project-wide (confirmed via `x-sb-error-code:
 * over_email_send_rate_limit`) - far too scarce a budget to spend on every
 * test run for a project with no custom SMTP relay configured.
 *
 * Instead this calls the Admin API's `generateLink` directly - an
 * admin-only call that does NOT send an email or touch the mailer quota -
 * and opens the resulting `action_link`. Supabase's Auth server verifies
 * the embedded token and redirects back with session tokens in the URL
 * fragment, which supabase-js picks up automatically on page load. This is
 * functionally the same end state as a user clicking a real magic-link
 * email, at zero cost against the mailer quota.
 *
 * Shared by auth.spec.ts and import-and-cook.spec.ts - every test that just
 * needs "an authenticated user" should use this, not the login form. Every
 * caller must run its test body in try/finally and call the returned
 * `cleanup()` to delete the throwaway user afterward (see
 * {@link TestUserSession}).
 */
export async function signInAsNewUser(page: Page): Promise<TestUserSession> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  // No need to visit /login or touch the form at all - just establish the
  // app's origin so redirectTo below lands back on this same dev server.
  await page.goto('/')
  const baseURL = new URL(page.url()).origin

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: baseURL },
  })
  const actionLink = data?.properties?.action_link
  // generateLink's response includes the full created/existing user object
  // (data.user.id) directly - no separate getUserByEmail/listUsers lookup
  // needed to find the id to delete later.
  const userId = data?.user?.id
  if (error || !actionLink || !userId) {
    throw new Error(
      `Failed to generate a sign-in link via the Supabase Admin API: ${
        error?.message ?? 'no action_link or user id in the response'
      }`,
    )
  }

  // From this point on, the real auth.users row for `userId` already
  // exists (generateLink created it as a side effect above), regardless of
  // what happens next. If the navigation or assertion below throws (flaky
  // navigation, a redirect regression, an auth-service hiccup, a timeout -
  // all realistic against a live hosted project), this function would
  // otherwise throw before ever returning the {cleanup} handle - meaning
  // the caller's own `const { cleanup } = await signInAsNewUser(page)`
  // line never completes, its try/finally never starts, and the
  // just-created user would leak with no way to identify or delete it
  // afterward. Catch here, delete the user we already have the id for,
  // then rethrow so the caller/test still sees and reports the real
  // failure - this only adds cleanup, it doesn't swallow the error.
  try {
    await page.goto(actionLink)
    // supabase-js clears the token hash after processing it (via
    // `location.hash = ''`), which in Chromium leaves a trailing `#`
    // rather than a perfectly clean path - so assert on the authenticated
    // page's content landing, not an exact URL string.
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  } catch (setupError) {
    await admin.auth.admin.deleteUser(userId).catch(() => {
      // Best-effort: if the delete itself also fails here, there's no
      // handle left to retry with, but we still must not mask the
      // original setup failure below.
    })
    throw setupError
  }

  return {
    email,
    userId,
    cleanup: async () => {
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
      if (deleteError) {
        throw new Error(`Failed to delete throwaway test user ${userId}: ${deleteError.message}`)
      }
    },
  }
}

/** Clicks the app's "Sign out" control and waits for the redirect to /login. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL('/login')
}
