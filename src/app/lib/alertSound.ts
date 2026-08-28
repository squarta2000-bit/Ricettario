let audioContext: AudioContext | null = null

// A short two-tone chime, used when cooking mode auto-advances to the next
// step - the user is often not looking at the screen while cooking, so the
// step-change needs an audible cue, not just a visual one.
export function playStepAlertSound(): void {
  try {
    if (!audioContext) {
      audioContext = new AudioContext()
    }
    const now = audioContext.currentTime
    ;[880, 1320].forEach((frequency, index) => {
      const oscillator = audioContext!.createOscillator()
      const gain = audioContext!.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      const start = now + index * 0.15
      gain.gain.setValueAtTime(0.2, start)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25)
      oscillator.connect(gain)
      gain.connect(audioContext!.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.25)
    })
  } catch {
    // Audio isn't available in every environment (e.g. some test runners) -
    // the visual alert still fires, so a failed beep is not user-facing.
  }
}
