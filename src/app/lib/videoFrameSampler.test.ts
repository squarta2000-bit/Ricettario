import { describe, it, expect } from 'vitest'
import { computeSampleTimestamps } from './videoFrameSampler'

describe('computeSampleTimestamps', () => {
  it('evenly spaces N timestamps strictly inside the duration', () => {
    expect(computeSampleTimestamps(10, 4)).toEqual([2, 4, 6, 8])
  })

  it('returns a single midpoint timestamp when only 1 frame fits', () => {
    expect(computeSampleTimestamps(10, 1)).toEqual([5])
  })

  it('never returns a timestamp at or beyond the duration', () => {
    const timestamps = computeSampleTimestamps(9, 3)
    for (const t of timestamps) {
      expect(t).toBeGreaterThan(0)
      expect(t).toBeLessThan(9)
    }
  })

  it('returns an empty array for a non-positive duration', () => {
    expect(computeSampleTimestamps(0, 5)).toEqual([])
    expect(computeSampleTimestamps(-1, 5)).toEqual([])
  })

  it('returns an empty array for a non-positive frame count', () => {
    expect(computeSampleTimestamps(10, 0)).toEqual([])
  })
})
