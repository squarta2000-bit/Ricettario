import type { Ingredient } from './types'

// This app targets a European audience, so numbers and dates always use
// the continental European convention (comma decimal separator, DD/MM/YYYY
// dates) - fixed regardless of the UI language the user has selected,
// unlike the page's own text, which does follow that selection.
const NUMBER_LOCALE = 'it-IT'
const DATE_LOCALE = 'it-IT'

export function formatNumber(value: number): string {
  // useGrouping defaults to "auto", which some ICU versions render without
  // a thousands separator even for it-IT - force it on explicitly.
  return new Intl.NumberFormat(NUMBER_LOCALE, { useGrouping: true }).format(value)
}

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat(DATE_LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

export function formatIngredientLine(ingredient: Ingredient): string {
  const quantity = ingredient.quantity != null ? `${formatNumber(ingredient.quantity)} ${ingredient.unit ?? ''} ` : ''
  return `${quantity}${ingredient.name}`
}
