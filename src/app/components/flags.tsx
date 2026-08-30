import { useId, type ReactNode } from 'react'

// Small inline SVG flags - emoji flags render as plain "GB"/"IT"/"FR" text
// on many Windows Chromium builds instead of an actual flag icon, so these
// guarantee a consistent look across every browser/OS. Each flag needs its
// own clipPath id (via useId) since several render at once in the dropdown
// list - a shared id would make later instances silently reuse the first
// flag's clip region in some browsers.
function FlagFrame({ children }: { children: ReactNode }) {
  const clipId = useId()
  return (
    <svg viewBox="0 0 60 40" className="size-4 rounded-[2px] shrink-0" aria-hidden="true">
      <clipPath id={clipId}>
        <rect width="60" height="40" rx="3" />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>{children}</g>
    </svg>
  )
}

export function FlagGB() {
  return (
    <FlagFrame>
      <rect width="60" height="40" fill="#00247d" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" strokeWidth="8" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#cf142b" strokeWidth="3.5" />
      <path d="M30,0 V40 M0,20 H60" stroke="#fff" strokeWidth="14" />
      <path d="M30,0 V40 M0,20 H60" stroke="#cf142b" strokeWidth="8" />
    </FlagFrame>
  )
}

export function FlagIT() {
  return (
    <FlagFrame>
      <rect width="20" height="40" fill="#009246" />
      <rect x="20" width="20" height="40" fill="#fff" />
      <rect x="40" width="20" height="40" fill="#ce2b37" />
    </FlagFrame>
  )
}

export function FlagFR() {
  return (
    <FlagFrame>
      <rect width="20" height="40" fill="#0055a4" />
      <rect x="20" width="20" height="40" fill="#fff" />
      <rect x="40" width="20" height="40" fill="#ef4135" />
    </FlagFrame>
  )
}
