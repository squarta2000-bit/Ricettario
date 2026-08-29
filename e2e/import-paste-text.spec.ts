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
