import { useTranslation } from '../lib/i18n/LanguageContext'
import { LANGUAGES, LANGUAGE_NAMES, type Language } from '../lib/i18n/translations'
import { FlagFR, FlagGB, FlagIT } from './flags'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'

const FLAGS: Record<Language, () => React.JSX.Element> = {
  en: FlagGB,
  it: FlagIT,
  fr: FlagFR,
}

export function LanguageSelector() {
  const { language, setLanguage, t } = useTranslation()
  const CurrentFlag = FLAGS[language]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={t('language.label')}>
          <CurrentFlag />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LANGUAGES.map((lang) => {
          const Flag = FLAGS[lang]
          return (
            <DropdownMenuItem key={lang} onSelect={() => setLanguage(lang)} className="gap-2">
              <Flag />
              {LANGUAGE_NAMES[lang]}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
