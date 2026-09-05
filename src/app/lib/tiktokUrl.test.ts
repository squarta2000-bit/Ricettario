import { describe, it, expect } from 'vitest'
import { isTiktokUrl } from './tiktokUrl'

describe('isTiktokUrl', () => {
  it('detects tiktok.com URLs', () => {
    expect(isTiktokUrl('https://www.tiktok.com/@user/video/123')).toBe(true)
    expect(isTiktokUrl('https://tiktok.com/@user/video/123')).toBe(true)
  })

  it('detects vm.tiktok.com short links', () => {
    expect(isTiktokUrl('https://vm.tiktok.com/ABC123/')).toBe(true)
  })

  it('detects vt.tiktok.com short links', () => {
    expect(isTiktokUrl('https://vt.tiktok.com/ZM123abc/')).toBe(true)
  })

  it('detects m.tiktok.com URLs', () => {
    expect(isTiktokUrl('https://m.tiktok.com/@user/video/123')).toBe(true)
  })

  it('returns false for unrelated URLs', () => {
    expect(isTiktokUrl('https://example.com/recipe')).toBe(false)
    expect(isTiktokUrl('https://youtu.be/abcdefghijk')).toBe(false)
  })
})
