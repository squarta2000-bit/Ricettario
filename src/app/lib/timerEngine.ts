export interface TimerStep {
  estimatedMinutes: number | null
}

export interface TimerState {
  currentStepIndex: number
  stepStartedAtMs: number
  isPaused: boolean
  elapsedBeforePauseMs: number
  isDone: boolean
}

export function startTimer(nowMs: number): TimerState {
  return { currentStepIndex: 0, stepStartedAtMs: nowMs, isPaused: false, elapsedBeforePauseMs: 0, isDone: false }
}

export function elapsedMsForCurrentStep(state: TimerState, nowMs: number): number {
  if (state.isPaused) return state.elapsedBeforePauseMs
  return state.elapsedBeforePauseMs + (nowMs - state.stepStartedAtMs)
}

export function shouldAutoAdvance(state: TimerState, steps: TimerStep[], nowMs: number): boolean {
  if (state.isDone) return false
  const step = steps[state.currentStepIndex]
  if (!step || step.estimatedMinutes == null) return false
  return elapsedMsForCurrentStep(state, nowMs) >= step.estimatedMinutes * 60_000
}

export function advanceStep(state: TimerState, steps: TimerStep[], nowMs: number): TimerState {
  if (state.currentStepIndex >= steps.length - 1) {
    return { ...state, isDone: true }
  }
  return {
    currentStepIndex: state.currentStepIndex + 1,
    stepStartedAtMs: nowMs,
    isPaused: false,
    elapsedBeforePauseMs: 0,
    isDone: false,
  }
}

export function goToStep(state: TimerState, index: number, steps: TimerStep[], nowMs: number): TimerState {
  const clamped = Math.max(0, Math.min(index, steps.length - 1))
  return { currentStepIndex: clamped, stepStartedAtMs: nowMs, isPaused: false, elapsedBeforePauseMs: 0, isDone: false }
}

export function pauseTimer(state: TimerState, nowMs: number): TimerState {
  if (state.isPaused) return state
  return { ...state, isPaused: true, elapsedBeforePauseMs: elapsedMsForCurrentStep(state, nowMs) }
}

export function resumeTimer(state: TimerState, nowMs: number): TimerState {
  if (!state.isPaused) return state
  return { ...state, isPaused: false, stepStartedAtMs: nowMs }
}
