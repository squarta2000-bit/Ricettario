import { test, expect } from '@playwright/test'
import { signInAsNewUser, signOut } from './helpers/auth'

test('shows check-your-email state after submitting the login form', async ({ page }) => {
  // Stub the real OTP-send endpoint so this test verifies the LoginPage's
  // own idle -> sending -> sent state transition without ever sending a
  // real email (Supabase's default mailer is capped at ~2 sends/hour
  // project-wide, with no custom SMTP configured for this project).
  // The trailing `**` is required: the real request always carries a
  // `?redirect_to=...` query string (from emailRedirectTo), and without a
  // wildcard after `otp` the glob is end-anchored and never matches, so the
  // route silently falls through to a real (rate-limited) network call.
  await page.route('**/auth/v1/otp**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/login')
  await page.screenshot({ path: 'e2e/screenshots/login.png' })

  await page.getByRole('tab', { name: 'Sign Up' }).click()
  await page.getByPlaceholder('you@example.com').fill('e2e-ui-check@example.com')
  await page.getByRole('button', { name: 'Sign up' }).click()

  await expect(page.getByText('Check your email')).toBeVisible()
})

test('sign in via a generated magic link and sign out', async ({ page }) => {
  // Uses the Admin API generateLink helper - no login form interaction, no
  // real network call to the rate-limited mailer endpoint at all.
  const { cleanup } = await signInAsNewUser(page)
  try {
    // HomePage renders nothing below the header until its async
    // listRecipes() fetch resolves; wait for the (guaranteed, since this is
    // a brand-new user) empty state before capturing the screenshot.
    await expect(page.getByText('No recipes yet')).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/home.png' })

    await signOut(page)
  } finally {
    // Always delete the throwaway user created above, even if an
    // assertion above failed - otherwise every run leaves a permanent
    // user behind on the hosted project.
    await cleanup()
  }
})

test('log in with just an email after being confirmed once, no email sent', async ({ page }) => {
  const { email, cleanup } = await signInAsNewUser(page)
  try {
    await signOut(page)

    await page.goto('/login')
    await page.getByPlaceholder('you@example.com').fill(email)
    await page.getByRole('button', { name: 'Log in' }).click()

    // A fresh, real call to /server/login against the hosted project -
    // no magic-link email involved, this is the passwordless "just check
    // the email exists" flow landing on the authenticated home page.
    await expect(page.getByText('No recipes yet')).toBeVisible()
  } finally {
    await cleanup()
  }
})

test('rejects login for an email that was never signed up', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('you@example.com').fill(`never-signed-up-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Log in' }).click()

  await expect(page.getByText('No account found for that email. Sign up first.')).toBeVisible()
})
