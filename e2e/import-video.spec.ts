// e2e/import-video.spec.ts
import path from 'path'
import { fileURLToPath } from 'url'
import { test, expect } from '@playwright/test'
import { signInAsNewUser, createAdminClient } from './helpers/auth'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('upload a recipe reel video, sample frames, review, and save it', async ({ page }) => {
  const { cleanup } = await signInAsNewUser(page)
  try {
    await page.goto('/import')
    await page.getByRole('tab', { name: 'Take Photos' }).click()
    await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, 'fixtures', 'recipe-reel.webm'))

    // The fixture is a ~3s video; computeSampleTimestamps requests up to
    // MAX_PHOTOS (5) evenly-spaced frames when there's no other photo
    // staged, but the fixture's canvas only changes color every 750ms while
    // frames are sampled more densely than that. sampleVideoFrames dedupes
    // byte-identical frames, so this fixture yields 3 unique frames rather
    // than 5 - confirming the dedup actually ran, not just that 5 were
    // requested.
    await expect(page.getByRole('button', { name: /^Remove photo/ })).toHaveCount(3)
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

    // Regression coverage for a real bug caught and fixed earlier in this
    // feature's development: saved recipes always persisted with
    // source_type 'photo' even when the upload came from a sampled video.
    // Query the DB directly via the service-role client (bypassing RLS) so
    // this actually checks the persisted value instead of only UI state.
    const recipeId = new URL(page.url()).pathname.split('/recipe/')[1]
    const admin = createAdminClient()
    const { data: recipe, error: recipeError } = await admin
      .from('recipes')
      .select('source_type')
      .eq('id', recipeId)
      .single()
    if (recipeError || !recipe) {
      throw new Error(`Failed to load the saved recipe to check its source_type: ${recipeError?.message}`)
    }
    expect(recipe.source_type).toBe('video')
  } finally {
    await cleanup()
  }
})
