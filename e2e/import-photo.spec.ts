import path from 'path'
import { fileURLToPath } from 'url'
import { test, expect } from '@playwright/test'
import { signInAsNewUser } from './helpers/auth'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('take photos of a recipe, review, and save it without a source link', async ({ page }) => {
  const { cleanup } = await signInAsNewUser(page)
  try {
    await page.goto('/import')
    await page.getByRole('tab', { name: 'Take Photos' }).click()
    await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, 'fixtures', 'recipe-photo.png'))
    await expect(page.getByRole('button', { name: /^Remove photo/ })).toHaveCount(1)

    await page.getByRole('button', { name: 'Extract recipe from photos' }).click()

    // This hits the real vision LLM extraction call, which can take longer
    // than the default 5s expect timeout under real network latency.
    await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: 'screenshot/import-photo-review.png' })

    await page.getByLabel('Title').fill('Photographed Soup')
    await page.getByLabel('Ingredients (one per line)').fill('1 can tomatoes')
    await page.getByLabel('Steps (one per line)').fill('Stir.\nServe.')
    await page.getByRole('button', { name: 'Save recipe' }).click()

    await expect(page).toHaveURL(/\/recipe\/[\w-]+$/)
    await expect(page.getByRole('heading', { name: 'Photographed Soup' })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Source/ })).toHaveCount(0)
    await page.screenshot({ path: 'screenshot/import-photo-detail.png' })
  } finally {
    await cleanup()
  }
})
