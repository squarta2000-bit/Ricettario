import { describe, it, expect } from 'vitest'
import { formatDuration, formatRecipeDuration } from './formatDuration'

describe('formatDuration', () => {
  it('shows minutes plainly under an hour', () => {
    expect(formatDuration(1)).toBe('1 min')
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(59)).toBe('59 min')
  })

  it('switches to h:mm at exactly 60 minutes', () => {
    expect(formatDuration(60)).toBe('1:00')
  })

  it('pads minutes to two digits', () => {
    expect(formatDuration(65)).toBe('1:05')
  })

  it('formats a multi-hour duration', () => {
    expect(formatDuration(160)).toBe('2:40')
  })

  it('does not pad the hours component', () => {
    expect(formatDuration(600)).toBe('10:00')
  })
})

describe('formatRecipeDuration', () => {
  it('shows both prep and cook when both are known', () => {
    expect(formatRecipeDuration({ prepMinutes: 40, cookMinutes: 120, totalMinutes: null })).toBe(
      'Prep 40 min · Cook 2:00',
    )
  })

  it('shows only whichever of prep/cook is known', () => {
    expect(formatRecipeDuration({ prepMinutes: null, cookMinutes: 45, totalMinutes: null })).toBe('Cook 45 min')
    expect(formatRecipeDuration({ prepMinutes: 10, cookMinutes: null, totalMinutes: null })).toBe('Prep 10 min')
  })

  it('falls back to totalMinutes when neither prep nor cook is known', () => {
    expect(formatRecipeDuration({ prepMinutes: null, cookMinutes: null, totalMinutes: 160 })).toBe('2:40')
  })

  it('returns null when nothing is known at all', () => {
    expect(formatRecipeDuration({ prepMinutes: null, cookMinutes: null, totalMinutes: null })).toBeNull()
  })

  it('prefers prep/cook over totalMinutes when both are present', () => {
    expect(formatRecipeDuration({ prepMinutes: 40, cookMinutes: null, totalMinutes: 999 })).toBe('Prep 40 min')
  })
})
