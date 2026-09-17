# Docurama E2E — Maestro browser suite

End-to-end coverage of the critical user journeys with
[Maestro](https://github.com/mobile-dev-inc/Maestro) driving headless Chrome
via CDP/Selenium.

## Quick start

```bash
bun run test:e2e            # boots a dev server (if needed), seeds, runs all flows
bash e2e/run.sh e2e/flows/auth/login.yaml   # one flow
bash e2e/run.sh e2e/flows/public/*.yaml     # a group of flows
```

The runner accepts any number of flow paths; with no arguments it runs the
whole suite. Flow order never matters — every flow is self-contained.

Requirements: `bun`, `maestro` on PATH
(`curl -Ls 'https://get.maestro.mobile.dev' | bash`), and a Chrome/Chromium
binary. In unprivileged containers Chrome needs `--no-sandbox` — a wrapper
script on `PATH` handles it (see CI notes below).

## Layout

```
e2e/
  seed.ts        Idempotent Prisma seed. Dedicated "E2E Testing" tenant,
                 e2e@docurama.eu / e2ePass1234! (workspace) and
                 e2e-admin@docurama.eu / e2eAdmin1234! (platform admin),
                 plus fixed-code fixtures DOC-E2E0001 (SENT) and
                 DOC-E2E0002 (COMPLETED + sealed). Wipes the tenant's
                 envelopes on every run — demo data is never touched.
  run.sh         Orchestrator: env guard → server → warm-up → seed → maestro →
                 report. Accepts zero or more flow paths (default: all).
  flows/
    public/      No-auth surfaces: marketing, French catalog, verify portal
                 (NOT_FOUND + seeded VERIFIED), docs/developers/status.
    auth/        Typed sign-in, demo one-click buttons, wrong password,
                 forgot password, sign-out.
    workspace/   Documents table, templates catalog, template→send→SENT
                 journey, envelope detail→void, in-app verify.
    admin/       Platform overview, users directory, platform settings.
```

## Selector conventions (important)

Maestro matches **element text with full-string regex**. Two Docurama-specific
rules follow from that:

1. **Buttons that render an icon before their label** (`<Lock/> Sign in
   securely`) carry a leading space in their text node — exact strings fail.
   Use tolerant regexes: `tapOn: " ?Sign in securely ?"`, `" ?Use template ?"`.
   Plain-text elements (`Sign in to your portal`) match exactly.
2. **Prefer `id:` selectors over text.** The web driver resolves `id` against
   the element `id` attribute, then `aria-label`. All form inputs in the send
   dialog have stable ids (`doc-title`, `recipient-1-name`,
   `recipient-1-email`). This is not just style: the driver's
   `inputText` builds an XPath from the focused element, and for id-less
   inputs that XPath is class-based **without a position index** — two
   same-class inputs are ambiguous and typing lands in the wrong field.
   (Found live; fixed by adding ids to the recipient inputs — see
   docs/IMPROVEMENT-PLAN.md §6.)

Other lessons baked into the flows:

- **Viewport**: run with `--screen-size 1440x1000` (the runner default). On
  shorter viewports the recipient row sits at the screen edge and taps
  misfire; `TAB` is not supported on web, so field-to-field navigation must
  be taps.
- **SPA transitions**: after login/navigation use `extendedWaitUntil` with
  regex (`visible: "Welcome back.*"` — the header, not the transient toast).
- **Dialog prefills**: "Use template" prefills the title — `eraseText: 100`
  before `inputText`.
- **No spaces in dialog inputText**: Maestro types per character and its
  Selenium `sendKeys(" ")` intermittently throws "element not interactable"
  inside Radix dialogs (reproduced on the void-reason input; first 3 chars
  landed, the space failed). Use hyphenated strings in dialog inputs:
  `"E2E-fixture-voided-by-maestro-suite"`, not `"E2E fixture voided …"`.
- **Radix overlays and focus**: dialogs with a required field should own
  `onOpenAutoFocus` (see `ConfirmDialog` in `src/components/portal/shared.tsx`)
  and row-action buttons must `stopPropagation()` — both were real UX bugs
  found by this suite, not test-only issues.
- **Cold-boot compile race**: in dev mode every route compiles on first hit,
  and a flow that navigates right after a cold server boot can race the
  compiler (seen live: the marketing CTA → `/welcome` exceeded a 10s wait on
  a cold sandbox server). The runner now warms the public routes once after
  boot, and first-navigation asserts use `extendedWaitUntil` with 30s
  timeouts.
- **Base URL**: flows reference `${MAESTRO_BASE_URL}`; the runner exports it
  (default `http://127.0.0.1:3000`), so the same suite can target staging or
  production smoke runs: `MAESTRO_BASE_URL=https://staging.example.com bun run test:e2e`.
- **`DATABASE_URL` guard**: an inherited shell `DATABASE_URL` overrides the
  app `.env` and breaks every DB route; the runner pins it to the repo db.
  Override with `E2E_DATABASE_URL` if you need a different database.

## CI

`.github/workflows/e2e.yml` runs the suite on push/PR against `quality` and
`main`: bun install → prisma generate → seed → `maestro test --headless`,
uploading Maestro debug artifacts when flows fail. The CI image needs a
`chromium` wrapper that injects `--no-sandbox --disable-dev-shm-usage` (the
workflow creates one).

## Writing new flows

- One journey per file; name files `area/subject.yaml`.
- Self-contained: every flow does its own login (typed, with the e2e account)
  — flows must stay order-independent so they can run in parallel or alone.
- All writes go to the E2E tenant; never use demo accounts for writes.
- Assert on stable UI text (headers, badges), never on toasts (they expire).
