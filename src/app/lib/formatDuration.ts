export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}:${String(remainingMinutes).padStart(2, '0')}`
}

// Prefers showing prep/cook separately (whichever of the two is known) over
// a single combined total, since a recipe's real prep and cook times can
// differ wildly (e.g. 40 min prep, 2h cook) - only falls back to the
// combined total when neither half is known. Returns null when there's no
// duration information at all, leaving it to the caller to decide whether
// to show a placeholder or omit the field entirely.
export function formatRecipeDuration(
  input: {
    prepMinutes: number | null
    cookMinutes: number | null
    totalMinutes: number | null
  },
  labels: { prep: string; cook: string } = { prep: 'Prep', cook: 'Cook' },
): string | null {
  const parts: string[] = []
  if (input.prepMinutes != null) parts.push(`${labels.prep} ${formatDuration(input.prepMinutes)}`)
  if (input.cookMinutes != null) parts.push(`${labels.cook} ${formatDuration(input.cookMinutes)}`)
  if (parts.length > 0) return parts.join(' · ')
  if (input.totalMinutes != null) return formatDuration(input.totalMinutes)
  return null
}
