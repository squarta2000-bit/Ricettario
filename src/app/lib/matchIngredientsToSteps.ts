import type { Ingredient, Step } from './types'

// Covers the app's three UI languages (en/it/fr) plus a few near-universal
// connectors - enough to stop generic words like "de" or "the" from
// producing false matches, without needing full per-language NLP.
const STOPWORDS = new Set([
  'de', 'du', 'la', 'le', 'les', 'et', 'un', 'une', 'des', 'au', 'aux', 'en', 'sur', 'avec',
  'the', 'and', 'of', 'a', 'an', 'in', 'for', 'to',
  'di', 'del', 'della', 'dello', 'e', 'con', 'per', 'un', 'una',
])

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function significantWords(name: string): string[] {
  return normalize(name)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
}

export function matchIngredientsForStep(step: Step, ingredients: Ingredient[]): Ingredient[] {
  const normalizedInstruction = normalize(step.instruction)

  return ingredients.filter((ingredient) =>
    significantWords(ingredient.name).some((word) => new RegExp(`\\b${word}\\b`).test(normalizedInstruction)),
  )
}
