import { describe, it, expect } from 'vitest'
import { formatNumber, formatDate } from './europeanFormat'

describe('formatNumber', () => {
  it('uses a comma as the decimal separator', () => {
    expect(formatNumber(2.5)).toBe('2,5')
  })

  it('leaves whole numbers unchanged', () => {
    expect(formatNumber(4)).toBe('4')
  })

  it('groups thousands with a period', () => {
    expect(formatNumber(1234.5)).toBe('1.234,5')
  })
})

describe('formatDate', () => {
  it('formats a date string as DD/MM/YYYY', () => {
    expect(formatDate('2026-03-05T12:00:00.000Z')).toBe('05/03/2026')
  })

  it('formats a Date object as DD/MM/YYYY', () => {
    expect(formatDate(new Date(2026, 0, 9))).toBe('09/01/2026')
  })
})
