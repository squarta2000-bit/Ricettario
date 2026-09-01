// e2e/import-video.spec.ts
import path from 'path'
import { fileURLToPath } from 'url'
import { test, expect } from '@playwright/test'
import { signInAsNewUser } from './helpers/auth'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('upload a recipe reel video, sample frames, review, and save it', async ({ page }) => {
  const { cleanup } = await signInAsNewUser(page)
  try {
    await page.goto('/import')
    await page.getByRole('tab', { name: 'Take Photos' }).click()
    await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, 'fixtures', 'recipe-reel.webm'))

    // The fixture is a ~3s video; computeSampleTimestamps produces up to
    // MAX_PHOTOS (5) evenly-spaced frames when there's no other photo staged.
    await expect(page.getByRole('button', { name: /^Remove photo/ })).toHaveCount(5)
    await page.screenshot({ path: 'screenshot/import-video-staged.png' })

    await page.getByRole('button', { name: 'Extract recipe from photos' }).click()

    // Hits the real vision LLM extraction call, same as the photo import test.
    await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: 'screenshot/import-video-review.png' })

    await page.getByLabel('Title').fill('Reel Soup')
    await page.getByLabel('Ingredients (one per line)').fill('1 can tomatoes')
    await page.getByLabel('Steps (one per line)').fill('Stir.\nServe.')
    await page.getByRole('button', { name: 'Save recipe' }).click()

    await expect(page).toHaveURL(/\/recipe\/[\w-]+$/)
    await expect(page.getByRole('heading', { name: 'Reel Soup' })).toBeVisible()
    await page.screenshot({ path: 'screenshot/import-video-detail.png' })
  } finally {
    await cleanup()
  }
})
