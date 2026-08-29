## Design principles
- Content leads; UI chrome stays quiet.
- One accent color only. No multi-color badges/icons.
- Thin hairline rules instead of card shadows/borders where possible.
- Generous margins — let layouts breathe like a printed page spread.

## Color tokens

```css
:root {
  --color-bg: #FAF7F2;          /* warm cream, not pure white */
  --color-bg-alt: #F7F3ED;      /* secondary surface */
  --color-text: #2B2620;        /* warm near-black, not pure black */
  --color-text-muted: #8C8776;  /* metadata, captions, dividers */
  --color-accent: #B8563E;      /* deep terracotta — use sparingly */
  --color-rule: #E4DDD1;        /* hairline dividers */
}

[data-theme="dark"] {
  --color-bg: #211D18;
  --color-bg-alt: #2A2520;
  --color-text: #F2EDE5;
  --color-text-muted: #9A9082;
  --color-accent: #D97A5E;      /* slightly lighter terracotta for contrast */
  --color-rule: #3A342C;
}
```

Alternate accent options (pick one, don't mix): olive `#6B7048`, burgundy `#7A2E2E`.

## Typography

- **Headings / recipe titles:** serif — Fraunces, Lora, or Source Serif 4.
- **Body / ingredients / steps:** sans — Inter or Work Sans.
- **Labels / metadata** (e.g. "SERVES 4 · 35 MIN"): same sans, uppercase, tracked out
  (`letter-spacing: 0.08em`, `font-size: 0.75rem`).

```css
--font-serif: "Fraunces", Georgia, serif;
--font-sans: "Inter", -apple-system, sans-serif;

--text-h1: 2.5rem;   /* recipe title */
--text-h2: 1.5rem;   /* section headers */
--text-body: 1rem;
--text-label: 0.75rem;
```

## Layout / components

- **Recipe cards (grid view):** title-forward, thin rule separator, minimal metadata row (time, servings) in tracked-out caps.
  No drop shadows — a 1px `--color-rule` border is enough.
- **Recipe detail page:** serif title, thin rule under metadata row, then ingredients/steps in sans.
- **Step numbers:** styled like typeset numerals (serif or oldstyle figures), not circular colored badges.
- **Icons:** thin-line, monochrome (`--color-text-muted`), never filled/colorful.
- **Buttons:** minimal — text + thin border or underline for primary actions;
  reserve solid `--color-accent` fill for the single most important CTA per screen
  (e.g. "Start Cooking").
- **Corners:** small radius only where needed (4-6px) — avoid heavy rounding,
  which reads as "app," not "cookbook."

## What to avoid
- Bright/saturated multi-color palettes.
- Heavy card shadows or elevation effects.
- Rounded pill buttons/badges everywhere.
- Stock "food emoji" icon sets — keep icons custom/thin-line if used at all.
