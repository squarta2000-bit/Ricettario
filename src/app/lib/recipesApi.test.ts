import { describe, it, expect } from 'vitest'
import { sumStepMinutes } from './recipesApi'

describe('sumStepMinutes', () => {
  it('sums estimated minutes across steps', () => {
    expect(sumStepMinutes([{ estimated_minutes: 5 }, { estimated_minutes: 10 }])).toBe(15)
  })

  it('returns null when every step is missing a time', () => {
    expect(sumStepMinutes([{ estimated_minutes: null }, { estimated_minutes: null }])).toBeNull()
  })

  it('sums the steps that do have a time and ignores the ones that do not', () => {
    expect(sumStepMinutes([{ estimated_minutes: 5 }, { estimated_minutes: null }])).toBe(5)
  })
})
