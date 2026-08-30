import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getRecipe } from '../lib/recipesApi'
import { playStepAlertSound } from '../lib/alertSound'
import { useTranslation } from '../lib/i18n/LanguageContext'
import {
  startTimer,
  advanceStep,
  goToStep,
  pauseTimer,
  resumeTimer,
  shouldAutoAdvance,
  elapsedMsForCurrentStep,
  type TimerState,
} from '../lib/timerEngine'
import type { RecipeWithDetails } from '../lib/types'
import { Button } from '../components/ui/button'
import { BackLink } from '../components/BackLink'
import { LanguageSelector } from '../components/LanguageSelector'

export default function CookingModePage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const [recipe, setRecipe] = useState<RecipeWithDetails | null>(null)
  const [timer, setTimer] = useState<TimerState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, forceTick] = useState(0)
  const [justAdvanced, setJustAdvanced] = useState(false)
  const alertedStepRef = useRef<string | null>(null)

  useEffect(() => {
    if (id)
      getRecipe(id)
        .then((r) => {
          setRecipe(r)
          setTimer(startTimer(Date.now()))
        })
        .catch(() => setError(t('cooking.loadError')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (!recipe || !timer) return
    const interval = setInterval(() => {
      const now = Date.now()
      setTimer((current) => {
        if (!current) return current
        const entryKey = `${current.currentStepIndex}:${current.stepStartedAtMs}`
        if (shouldAutoAdvance(current, recipe.steps, now) && alertedStepRef.current !== entryKey) {
          alertedStepRef.current = entryKey
          playStepAlertSound()
          setJustAdvanced(true)
          return advanceStep(current, recipe.steps, now)
        }
        return current
      })
      forceTick((t) => t + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [recipe, timer])

  useEffect(() => {
    if (!justAdvanced) return
    const timeout = setTimeout(() => setJustAdvanced(false), 1500)
    return () => clearTimeout(timeout)
  }, [justAdvanced])

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="max-w-xl w-full px-4 text-center">
          <p className="text-destructive text-sm mb-4">{error}</p>
          <Button asChild variant="outline">
            <Link to="/">{t('cooking.backToRecipes')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (!recipe || !timer) return null

  if (recipe.steps.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="max-w-xl w-full px-4 text-center">
          <h1 className="font-serif text-3xl mb-4">{t('cooking.noStepsHeading')}</h1>
          <Button asChild>
            <Link to={`/recipe/${recipe.id}`}>{t('cooking.backToRecipe')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  const step = recipe.steps[timer.currentStepIndex]
  const elapsedSeconds = Math.floor(elapsedMsForCurrentStep(timer, Date.now()) / 1000)
  const remainingSeconds = step.estimatedMinutes != null ? Math.max(0, step.estimatedMinutes * 60 - elapsedSeconds) : null

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="max-w-xl w-full px-4 text-center">
        <div className="flex items-center justify-between text-left">
          <BackLink to={`/recipe/${recipe.id}`}>{t('cooking.backLink')}</BackLink>
          <LanguageSelector />
        </div>
        {timer.isDone ? (
          <>
            <h1 className="font-serif text-3xl mb-4">{t('cooking.doneHeading')}</h1>
            <Button asChild>
              <Link to={`/recipe/${recipe.id}`}>{t('cooking.backToRecipe')}</Link>
            </Button>
          </>
        ) : (
          <>
            <div
              className={`rounded-lg p-4 mb-2 transition-colors duration-700 ${
                justAdvanced ? 'bg-accent ring-2 ring-primary' : ''
              }`}
            >
              <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground mb-2">
                {t('cooking.stepOf', { current: timer.currentStepIndex + 1, total: recipe.steps.length })}
              </p>
              <p className="text-xl mb-4">{step.instruction}</p>
              {remainingSeconds != null && (
                <p className="text-4xl font-mono mb-6">
                  {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')}
                </p>
              )}
            </div>
            <div className="flex gap-2 justify-center">
              <Button
                variant="outline"
                onClick={() => setTimer(goToStep(timer, timer.currentStepIndex - 1, recipe.steps, Date.now()))}
                disabled={timer.currentStepIndex === 0}
              >
                {t('cooking.back')}
              </Button>
              <Button
                variant="outline"
                onClick={() => setTimer(timer.isPaused ? resumeTimer(timer, Date.now()) : pauseTimer(timer, Date.now()))}
              >
                {timer.isPaused ? t('cooking.resume') : t('cooking.pause')}
              </Button>
              <Button onClick={() => setTimer(advanceStep(timer, recipe.steps, Date.now()))}>
                {t('cooking.nextStep')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
