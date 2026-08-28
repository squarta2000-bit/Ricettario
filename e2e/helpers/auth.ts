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
 * needs "an authenticated user" should use this, not the login form.
 * Returns the email that was signed in, in case a test wants to assert on it.
 */
export async function signInAsNewUser(page: Page): Promise<string> {
  const serviceRoleKey = requireServiceRoleKey()
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  // No need to visit /login or touch the form at all - just establish the
  // app's origin so redirectTo below lands back on this same dev server.
  await page.goto('/')
  const baseURL = new URL(page.url()).origin

  const admin = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: baseURL },
  })
  const actionLink = data?.properties?.action_link
  if (error || !actionLink) {
    throw new Error(
      `Failed to generate a sign-in link via the Supabase Admin API: ${
        error?.message ?? 'no action_link in the response'
      }`,
    )
  }

  await page.goto(actionLink)
  // supabase-js clears the token hash after processing it (via
  // `location.hash = ''`), which in Chromium leaves a trailing `#` rather
  // than a perfectly clean path - so assert on the authenticated page's
  // content landing, not an exact URL string.
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

  return email
}

/** Clicks the app's "Sign out" control and waits for the redirect to /login. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL('/login')
}
