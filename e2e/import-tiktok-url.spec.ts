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
