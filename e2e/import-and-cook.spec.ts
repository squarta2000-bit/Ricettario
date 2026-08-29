import { test, expect } from '@playwright/test'
import { signInAsNewUser, createAdminClient } from './helpers/auth'

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

    await page.getByLabel('Title').fill('Three-Second Soup')
    await page.getByLabel('Ingredients (one per line)').fill('1 can tomatoes')
    await page.getByLabel('Steps (one per line)').fill('Stir.\nServe.')
    await page.getByRole('button', { name: 'Save recipe' }).click()

    await expect(page).toHaveURL(/\/recipe\/[\w-]+$/)
    // RecipeDetailPage renders nothing until its async getRecipe() fetch
    // resolves, so wait for real content before capturing the screenshot.
    await expect(page.getByRole('heading', { name: 'Three-Second Soup' })).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/recipe-detail.png' })

    // The manual-entry review screen's textarea only sets step instruction
    // text - there's no UI control for per-step minutes - so a plain
    // through-the-UI save always leaves estimated_minutes null, and the
    // cooking-mode timer's countdown/auto-advance never actually fires.
    // Seed real, very short durations directly via the service-role client
    // so this test can exercise that behavior for real instead of only
    // manual button-click navigation.
    const recipeId = new URL(page.url()).pathname.split('/recipe/')[1]
    const admin = createAdminClient()
    const { data: steps, error: stepsError } = await admin
      .from('steps')
      .select('id')
      .eq('recipe_id', recipeId)
      .order('position', { ascending: true })
    if (stepsError || !steps || steps.length !== 2) {
      throw new Error(`Failed to load the saved recipe's steps to seed durations: ${stepsError?.message}`)
    }
    // 0.05 minutes = 3 seconds - short enough to wait out with a real
    // wall-clock pause, long enough not to be flaky against the 1s timer tick.
    const { error: updateError } = await admin
      .from('steps')
      .update({ estimated_minutes: 0.05 })
      .in('id', steps.map((s) => s.id))
    if (updateError) throw updateError

    await page.getByRole('link', { name: 'Start cooking' }).click()
    await expect(page).toHaveURL(/\/cook$/)
    // Same story for CookingModePage - it renders nothing until its recipe
    // fetch resolves and the timer starts.
    await expect(page.getByText('Step 1 of 2')).toBeVisible()
    // The countdown only renders when the current step has a known
    // duration - confirms the seeded estimated_minutes made it into the
    // timer, not just the step list.
    await expect(page.getByText(/^0:0\d$/)).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/cooking-mode.png' })

    // Wait past the 3-second step duration without clicking anything, and
    // confirm the app auto-advances to step 2 on its own.
    await page.waitForTimeout(4000)
    await expect(page.getByText('Step 2 of 2')).toBeVisible()

    await page.getByRole('button', { name: 'Pause' }).click()
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
    await page.getByRole('button', { name: 'Resume' }).click()
    await page.getByRole('button', { name: 'Next step' }).click()
    await expect(page.getByText('Done cooking!')).toBeVisible()
  } finally {
    // Always delete the throwaway user (and, via cascade, the recipe it
    // owns) created above, even if an assertion above failed.
    await cleanup()
  }
})
