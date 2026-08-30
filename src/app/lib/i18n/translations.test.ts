import { describe, it, expect } from 'vitest'
import { en, it as itDict, fr, LANGUAGES, TRANSLATIONS, LANGUAGE_NAMES } from './translations'

describe('translations', () => {
  const enKeys = Object.keys(en).sort()

  it('has every English key present in Italian and French, and no extras', () => {
    expect(Object.keys(itDict).sort()).toEqual(enKeys)
    expect(Object.keys(fr).sort()).toEqual(enKeys)
  })

  it('has no empty translation values in any language', () => {
    for (const dict of [en, itDict, fr]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.length, `key "${key}" is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('has a name for every supported language', () => {
    for (const lang of LANGUAGES) {
      expect(LANGUAGE_NAMES[lang]).toBeTruthy()
      expect(TRANSLATIONS[lang]).toBeTruthy()
    }
  })

  it('preserves {placeholder} tokens identically across languages that use them', () => {
    const placeholderPattern = /\{(\w+)\}/g
    for (const key of enKeys) {
      const enPlaceholders = [...en[key as keyof typeof en].matchAll(placeholderPattern)].map((m) => m[1]).sort()
      if (enPlaceholders.length === 0) continue
      for (const dict of [itDict, fr]) {
        const placeholders = [...dict[key as keyof typeof en].matchAll(placeholderPattern)].map((m) => m[1]).sort()
        expect(placeholders, `key "${key}"`).toEqual(enPlaceholders)
      }
    }
  })
})
