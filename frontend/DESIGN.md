# Docurama Frontend Design System

Derived from the pre-Sprint-3 design research (designprompts.dev, designmd.co,
beautifului.dev, ui.aceternity.com). This is the working contract for every new
surface; it is intentionally short enough to be followed rather than admired.

## Tokens

| Token | Value | Use |
|---|---|---|
| `bg-page` | `#f6f5f4` | page background (warm paper, Notion-adjacent) |
| `surface` | `#ffffff` | cards, tables, sheets |
| `ink` | `#37352f` | primary text and solid actions |
| `ink-muted` | `#64748B` | secondary text, captions |
| `border` | `#E2E8F0` | hairlines, card borders |
| `accent` | `#5645d4` | primary actions, links, focus rings |
| `danger` | `bg-red-100 / text-red-800` | destructive and tight-SLA badges |
| `warning` | `bg-amber-100 / text-amber-800` | pending and near-due states |
| `ok` | `bg-emerald-100 / text-emerald-800` | resolved, active states |

Typography: the existing system sans stack at 14px base. Numeric columns in
tables stay tabular (`font-variant-numeric: tabular-nums`) once a mono token
lands. Radii: 6px controls, 8px cards. Motion: 150-200ms ease-out on color and
opacity only; nothing bounces, nothing slides without a purpose.

## Accessibility floor (non-negotiable)

1. Every interactive element is reachable and operable by keyboard; visible
   focus using `focus:ring-2 focus:ring-[#37352f]/20` or the accent ring.
2. Icon-only buttons carry an `aria-label`. Toggles expose state via
   `aria-checked`/`aria-expanded` - the historic suite had exactly one
   aria-label in total; new surfaces must not continue that pattern.
3. Text contrast ≥ 4.5:1 against its background token.
4. Status is never conveyed by color alone - pair badges with text.
5. Modals and dialogs trap focus and restore it on close (when one is added).

## Honest-status rule

Compliance and availability claims are rendered in the platform's canonical
vocabulary only: **Implemented / Partial / Missing / Needs Review**, and
program language is limited to "GDPR compliance program", "ISO 27001 aligned",
"SOC 2 readiness", "compliance evidence available". Never "certified". A plan
without a configured price renders as "coming soon", not as a purchasable
button. A surface whose backend answers 503 renders the 503's reason, not a
fake success state.

## Legal-friction rule

Screens that touch consent, activation, or legal intake state the fact and the
consequence in one sentence, next to the control: what is recorded, how long it
is kept, and how to undo it. Consent checkboxes are never pre-ticked; the age
statement is a confirmation, not an interrogation.
