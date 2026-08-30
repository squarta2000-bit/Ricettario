import { describe, it, expect } from 'vitest'
import { interpolate } from './interpolate'

describe('interpolate', () => {
  it('returns the template unchanged when there are no vars', () => {
    expect(interpolate('Import recipe')).toBe('Import recipe')
  })

  it('substitutes a single placeholder', () => {
    expect(interpolate('Serves {count}', { count: 4 })).toBe('Serves 4')
  })

  it('substitutes multiple placeholders', () => {
    expect(interpolate('Step {current} of {total}', { current: 2, total: 5 })).toBe('Step 2 of 5')
  })

  it('accepts string values as well as numbers', () => {
    expect(interpolate('Serves {count}', { count: '6 persone' })).toBe('Serves 6 persone')
  })

  it('leaves unmatched placeholders as-is', () => {
    expect(interpolate('Step {current} of {total}', { current: 1 })).toBe('Step 1 of {total}')
  })
})
