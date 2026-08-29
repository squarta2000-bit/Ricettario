import { describe, it, expect } from 'vitest'
import { computeResizedDimensions } from './imageResize'

describe('computeResizedDimensions', () => {
  it('leaves an image unchanged when both dimensions are within the max', () => {
    expect(computeResizedDimensions(300, 200, 1500)).toEqual({ width: 300, height: 200 })
  })

  it('leaves an image unchanged when both dimensions equal the max', () => {
    expect(computeResizedDimensions(1500, 1500, 1500)).toEqual({ width: 1500, height: 1500 })
  })

  it('scales down proportionally when width is the larger dimension', () => {
    expect(computeResizedDimensions(3000, 1500, 1500)).toEqual({ width: 1500, height: 750 })
  })

  it('scales down proportionally when height is the larger dimension', () => {
    expect(computeResizedDimensions(1200, 3000, 1500)).toEqual({ width: 600, height: 1500 })
  })
})
