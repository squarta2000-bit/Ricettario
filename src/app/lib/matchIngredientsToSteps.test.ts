import { describe, it, expect } from 'vitest'
import { matchIngredientsForStep } from './matchIngredientsToSteps'
import type { Ingredient, Step } from './types'

function ingredient(overrides: Partial<Ingredient>): Ingredient {
  return {
    id: 'ing-1',
    recipeId: 'recipe-1',
    position: 0,
    rawText: overrides.name ?? '',
    quantity: null,
    unit: null,
    name: '',
    ...overrides,
  }
}

function step(instruction: string): Step {
  return { id: 'step-1', recipeId: 'recipe-1', position: 0, instruction, estimatedMinutes: null }
}

describe('matchIngredientsForStep', () => {
  it('matches an ingredient whose name appears in the step instruction', () => {
    const cream = ingredient({ name: 'crème liquide entière' })
    const result = matchIngredientsForStep(step('Verser 50 cl de crème et le lait'), [cream])
    expect(result).toEqual([cream])
  })

  it('matches regardless of accents or case', () => {
    const cream = ingredient({ name: 'Crème liquide entière' })
    const result = matchIngredientsForStep(step('verser la CREME dans la casserole'), [cream])
    expect(result).toEqual([cream])
  })

  it('does not match when no significant word overlaps', () => {
    const butter = ingredient({ name: 'beurre' })
    const result = matchIngredientsForStep(step('Chauffer votre four à 180°'), [butter])
    expect(result).toEqual([])
  })

  it('matches a short but meaningful word like "ail"', () => {
    const garlic = ingredient({ name: 'ail rose' })
    const result = matchIngredientsForStep(step("Frotter le plat avec de l'ail et la moitié du beurre"), [garlic])
    expect(result).toEqual([garlic])
  })

  it('ignores stopwords shared between languages', () => {
    // "de" is the only word in common between the ingredient name and the
    // step text - it must be filtered as a stopword, not treated as a match.
    const cream = ingredient({ name: 'crème de la ferme' })
    const result = matchIngredientsForStep(step('Ajouter de la farine'), [cream])
    expect(result).toEqual([])
  })

  it('only matches whole words, not substrings inside longer words', () => {
    const rice = ingredient({ name: 'riz' })
    const result = matchIngredientsForStep(step('Verser le riziere dans le plat'), [rice])
    expect(result).toEqual([])
  })

  it('returns every matching ingredient in the original list order', () => {
    const cream = ingredient({ id: 'ing-cream', name: 'crème liquide entière' })
    const milk = ingredient({ id: 'ing-milk', name: 'lait entier' })
    const butter = ingredient({ id: 'ing-butter', name: 'beurre' })
    const result = matchIngredientsForStep(
      step('Verser 50 cl de crème et le lait dans une grande casserole'),
      [cream, milk, butter],
    )
    expect(result).toEqual([cream, milk])
  })
})
