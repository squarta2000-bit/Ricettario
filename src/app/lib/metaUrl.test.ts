import { describe, it, expect } from 'vitest'
import { isInstagramOrFacebookUrl } from './metaUrl'

describe('isInstagramOrFacebookUrl', () => {
  it('matches Instagram links', () => {
    expect(isInstagramOrFacebookUrl('https://www.instagram.com/reel/abc123/')).toBe(true)
    expect(isInstagramOrFacebookUrl('https://instagram.com/p/abc123/')).toBe(true)
  })

  it('matches Facebook links, including fb.watch short links', () => {
    expect(isInstagramOrFacebookUrl('https://www.facebook.com/reel/123456')).toBe(true)
    expect(isInstagramOrFacebookUrl('https://fb.watch/abc123/')).toBe(true)
  })

  it('does not match unrelated URLs', () => {
    expect(isInstagramOrFacebookUrl('https://example.com/recipe')).toBe(false)
    expect(isInstagramOrFacebookUrl('https://youtu.be/abcdefghijk')).toBe(false)
  })
})
