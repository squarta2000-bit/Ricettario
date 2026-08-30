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

    // This hits the real LLM extraction call, which can take longer than
    // the default 5s expect timeout under real network latency.
    await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: 'screenshot/import-paste-text-review.png' })

    await page.getByLabel('Title').fill('Pasted Soup')
    await page.getByLabel('Ingredients (one per line)').fill('1 can tomatoes')
    await page.getByLabel('Steps (one per line)').fill('Stir.\nServe.')
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
