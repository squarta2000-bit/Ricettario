import { test, expect } from '@playwright/test'
import { signInAsNewUser, signOut } from './helpers/auth'

test('shows check-your-email state after submitting the login form', async ({ page }) => {
  // Stub the real OTP-send endpoint so this test verifies the LoginPage's
  // own idle -> sending -> sent state transition without ever sending a
  // real email (Supabase's default mailer is capped at ~2 sends/hour
  // project-wide, with no custom SMTP configured for this project).
  await page.route('**/auth/v1/otp', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/login')
  await page.screenshot({ path: 'e2e/screenshots/login.png' })

  await page.getByPlaceholder('you@example.com').fill('e2e-ui-check@example.com')
  await page.getByRole('button', { name: 'Sign in' }).click()

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
