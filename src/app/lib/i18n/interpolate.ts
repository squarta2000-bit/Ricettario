export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  let text = template
  for (const [name, value] of Object.entries(vars)) {
    text = text.replace(`{${name}}`, String(value))
  }
  return text
}
