import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../authContext'
import { supabase } from '../supabaseClient'
import { LANGUAGES, TRANSLATIONS, type Language, type TranslationKey } from './translations'
import { interpolate } from './interpolate'

const STORAGE_KEY = 'ricettario:language'
const DEFAULT_LANGUAGE: Language = 'en'

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

function loadStoredLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY)
  return isLanguage(stored) ? stored : DEFAULT_LANGUAGE
}

interface LanguageContextValue {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [language, setLanguageState] = useState<Language>(loadStoredLanguage)

  // The account's saved preference (available at login on any device) is
  // the source of truth once a session loads; localStorage is only a fast
  // local cache used before that (e.g. on the login screen).
  useEffect(() => {
    const accountLanguage = session?.user?.user_metadata?.language
    if (isLanguage(accountLanguage) && accountLanguage !== language) {
      setLanguageState(accountLanguage)
      localStorage.setItem(STORAGE_KEY, accountLanguage)
    }
  }, [session, language])

  function setLanguage(next: Language) {
    setLanguageState(next)
    localStorage.setItem(STORAGE_KEY, next)
    if (session) {
      supabase.auth.updateUser({ data: { language: next } })
    }
  }

  function t(key: TranslationKey, vars?: Record<string, string | number>): string {
    return interpolate(TRANSLATIONS[language][key], vars)
  }

  return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>
}

export function useTranslation() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useTranslation must be used within a LanguageProvider')
  return context
}
