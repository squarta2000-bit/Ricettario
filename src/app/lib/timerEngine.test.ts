import { describe, it, expect } from 'vitest'
import {
  startTimer,
  elapsedMsForCurrentStep,
  shouldAutoAdvance,
  advanceStep,
  goToStep,
  pauseTimer,
  resumeTimer,
  type TimerStep,
} from './timerEngine'

const steps: TimerStep[] = [{ estimatedMinutes: 2 }, { estimatedMinutes: 6 }, { estimatedMinutes: null }]

describe('timerEngine', () => {
  it('starts at step 0 with zero elapsed time', () => {
    const state = startTimer(1000)
    expect(state.currentStepIndex).toBe(0)
    expect(elapsedMsForCurrentStep(state, 1000)).toBe(0)
  })

  it('tracks elapsed time as it runs', () => {
    const state = startTimer(1000)
    expect(elapsedMsForCurrentStep(state, 1000 + 30_000)).toBe(30_000)
  })

  it('does not auto-advance before the step time elapses', () => {
    const state = startTimer(0)
    expect(shouldAutoAdvance(state, steps, 1 * 60_000)).toBe(false)
  })

  it('auto-advances once the step time elapses', () => {
    const state = startTimer(0)
    expect(shouldAutoAdvance(state, steps, 2 * 60_000)).toBe(true)
  })

  it('never auto-advances a step with no estimated time', () => {
    const state = { ...startTimer(0), currentStepIndex: 2 }
    expect(shouldAutoAdvance(state, steps, 999 * 60_000)).toBe(false)
  })

  it('advanceStep moves to the next step and resets its clock', () => {
    const state = startTimer(0)
    const next = advanceStep(state, steps, 5000)
    expect(next.currentStepIndex).toBe(1)
    expect(elapsedMsForCurrentStep(next, 5000)).toBe(0)
  })

  it('advanceStep marks done instead of overrunning past the last step', () => {
    const state = { ...startTimer(0), currentStepIndex: 2 }
    const next = advanceStep(state, steps, 5000)
    expect(next.isDone).toBe(true)
    expect(next.currentStepIndex).toBe(2)
  })

  it('goToStep jumps directly and resets isDone', () => {
    const state = { ...startTimer(0), currentStepIndex: 2, isDone: true }
    const next = goToStep(state, 0, steps, 5000)
    expect(next.currentStepIndex).toBe(0)
    expect(next.isDone).toBe(false)
  })

  it('goToStep clamps out-of-range indexes', () => {
    const state = startTimer(0)
    expect(goToStep(state, 99, steps, 0).currentStepIndex).toBe(steps.length - 1)
    expect(goToStep(state, -5, steps, 0).currentStepIndex).toBe(0)
  })

  it('pause freezes elapsed time and resume continues it', () => {
    let state = startTimer(0)
    state = pauseTimer(state, 10_000)
    expect(elapsedMsForCurrentStep(state, 999_999)).toBe(10_000)
    state = resumeTimer(state, 20_000)
    expect(elapsedMsForCurrentStep(state, 25_000)).toBe(15_000)
  })
})
