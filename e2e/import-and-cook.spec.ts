import { test, expect } from '@playwright/test'
import { signInAsNewUser } from './helpers/auth'

test('review-and-save a manually entered recipe, then cook it', async ({ page }) => {
  const { cleanup } = await signInAsNewUser(page)
  try {
    await page.goto('/import')
    await page
      .getByPlaceholder('https://example.com/recipe or a YouTube URL')
      .fill('https://nonexistent.invalid/recipe')
    await page.getByRole('button', { name: 'Import' }).click()

    // The import edge function isn't deployed in this environment (and the
    // URL is deliberately unreachable), so this exercises the graceful
    // failure path: the review screen opens with an empty form rather than
    // dead-ending, and the user can fill it in by hand. (The heading is
    // present in this branch whether or not the import errored; matching on
    // it alone avoids a strict-mode violation against the separate error
    // message paragraph, which is also visible at the same time.)
    await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/import-review.png' })

    // The "Title" <label> isn't programmatically associated with its <input>
    // (no htmlFor/id in ImportPage.tsx), so getByLabel can't resolve it. It's
    // the only <input> on this screen - ingredients/steps use <textarea> - so
    // target it positionally instead.
    await page.locator('input').first().fill('Three-Second Soup')
    await page.locator('textarea').nth(0).fill('1 can tomatoes')
    await page.locator('textarea').nth(1).fill('Stir.\nServe.')
    await page.getByRole('button', { name: 'Save recipe' }).click()

    await expect(page).toHaveURL(/\/recipe\/[\w-]+$/)
    // RecipeDetailPage renders nothing until its async getRecipe() fetch
    // resolves, so wait for real content before capturing the screenshot.
    await expect(page.getByRole('heading', { name: 'Three-Second Soup' })).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/recipe-detail.png' })

    await page.getByRole('link', { name: 'Start cooking' }).click()
    await expect(page).toHaveURL(/\/cook$/)
    // Same story for CookingModePage - it renders nothing until its recipe
    // fetch resolves and the timer starts.
    await expect(page.getByText('Step 1 of 2')).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/cooking-mode.png' })

    await page.getByRole('button', { name: 'Pause' }).click()
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
    await page.getByRole('button', { name: 'Resume' }).click()
    await page.getByRole('button', { name: 'Next step' }).click()
    await page.getByRole('button', { name: 'Next step' }).click()
    await expect(page.getByText('Done cooking!')).toBeVisible()
  } finally {
    // Always delete the throwaway user (and, via cascade, the recipe it
    // owns) created above, even if an assertion above failed.
    await cleanup()
  }
})
