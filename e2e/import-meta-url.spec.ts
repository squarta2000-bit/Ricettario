// e2e/import-meta-url.spec.ts
import { test, expect } from '@playwright/test'
import { signInAsNewUser } from './helpers/auth'

test('pasting an Instagram Reel link that fails shows the upload-fallback message, not the generic one', async ({ page }) => {
  const { cleanup } = await signInAsNewUser(page)
  try {
    await page.goto('/import')
    await page
      .getByPlaceholder('https://example.com/recipe, a YouTube URL, or an Instagram/Facebook Reel link')
      .fill('https://www.instagram.com/reel/nonexistent-fixture-post/')
    await page.getByRole('button', { name: 'Import' }).click()

    // No real Meta app credentials are guaranteed to be configured against
    // this environment, so this call is expected to fail - the point of
    // this test is confirming the failure surfaces the Instagram/Facebook
    // specific nudge (pointing at the upload fallback), not the generic
    // import error message.
    await expect(page.getByText("Couldn't get a recipe from that link")).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: 'screenshot/import-meta-url-error.png' })
  } finally {
    await cleanup()
  }
})
