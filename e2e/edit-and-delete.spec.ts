import { test, expect } from '@playwright/test'
import { signInAsNewUser } from './helpers/auth'

test('edit a saved recipe from the home page, then delete it', async ({ page }) => {
  const { cleanup } = await signInAsNewUser(page)
  try {
    await page.goto('/import')
    await page
      .getByLabel('Recipe URL')
      .fill('https://nonexistent.invalid/recipe')
    await page.getByRole('button', { name: 'Import' }).click()

    // Unreachable URL -> graceful failure path -> empty, manually-fillable form.
    await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible()
    await page.getByLabel('Title').fill('Edit Me')
    await page.getByLabel('Ingredients (one per line)').fill('1 egg')
    await page.getByLabel('Steps (one per line)').fill('Step one.\nStep two.')
    await page.getByRole('button', { name: 'Save recipe' }).click()
    await expect(page).toHaveURL(/\/recipe\/[\w-]+$/)

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Edit Me' })).toBeVisible()

    await page.getByRole('link', { name: 'Edit', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Edit recipe' })).toBeVisible()
    await expect(page.getByLabel('Title')).toHaveValue('Edit Me')
    await expect(page.getByLabel('Ingredients (one per line)')).toHaveValue('1 egg')
    await expect(page.getByLabel('Steps (one per line)')).toHaveValue('Step one.\nStep two.')

    await page.getByLabel('Title').fill('Edited Title')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page).toHaveURL(/\/recipe\/[\w-]+$/)
    await expect(page.getByRole('heading', { name: 'Edited Title' })).toBeVisible()

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Edited Title' })).toBeVisible()

    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('heading', { name: 'Delete this recipe?' })).toBeVisible()
    await expect(page.getByText('This will permanently delete "Edited Title"', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click()

    await expect(page.getByText('No recipes yet')).toBeVisible()
  } finally {
    await cleanup()
  }
})
