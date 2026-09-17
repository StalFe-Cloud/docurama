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
                 fixed-code fixtures DOC-E2E0001 (SENT), DOC-E2E0002
                 (COMPLETED + sealed), DOC-E2E0003 (decline flow) and
                 DOC-E2E0004 (signer journey), fixed signing tokens for the
                 signer-portal flows, an API key (ENVELOPES scope) for the
                 API-layer tests, and an attested-verification fixture
                 DOC-E2EATST (remote "self-hosted instance" registry row
                 with a real openssl key, a real transparency chain claim,
                 and a portal-log witnessing entry). Wipes its own fixtures
                 and the portal registry tables on every run — demo data is
                 never touched.
  api.test.ts    API-layer suite (bun test): X-API-Key auth, scope 403s,
                 verify-engine states, list/detail reads, sign-endpoint
                 validation, and a leak check that signing tokens never
                 appear in v1 payloads.
  evidence.test.ts  Evidence-layer suite (bun test): downloads an evidence
                 pack over the v1 API, parses the raw ZIP itself, re-verifies
                 the manifest signature + every artifact hash (what
                 verify.html does in a browser); runs the /api/attestations
                 receiver loopback (TOFU registration, idempotent re-push,
                 tampered signature, stolen thumbprint, pinned-key swap,
                 cross-instance code claim 409); pure-function tests for the
                 SPF/DMARC posture parsers.
  transparency.test.ts  Transparency-registry suite (bun test): pack
                 transparency block verified offline (commitment recomputed
                 from manifest-only fields → chain → signed checkpoint),
                 tampered commitment/segment detection, receiver chain-claim
                 validation (commitment mismatch 400, inconsistent entry
                 400), **chain rewrite detection 409**, idempotent no-grow,
                 signed checkpoint verification, and inclusion proofs for the
                 seeded fixture (incl. a tamper path).
  run.sh         Orchestrator: env guard → server → warm-up → seed → tsc
                 gate → API + evidence + transparency tests → maestro →
                 report. Accepts zero or more flow paths (default: all).
  flows/
    public/      No-auth surfaces: marketing, French catalog, verify portal
                 (NOT_FOUND + seeded VERIFIED + attested DOC-E2EATST),
                 docs/developers/status, signer-portal invalid-link state.
    auth/        Typed sign-in, demo one-click buttons, wrong password,
                 forgot password, sign-out.
    workspace/   Documents table, templates catalog, template→send→SENT
                 journey, envelope detail→void, in-app verify, per-signer
                 link copy + QR handoff, evidence-pack export entry point,
                 and the signer journeys: sign→seal→public-verify and
                 decline-with-reason.
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

3. **Icon-only buttons are addressable only through `id:`** — their
   accessible name comes from `aria-label`, which text selectors do not see.
   `id:` resolves against `aria-label`, so `tapOn: { id: "Copy signing link
   for Fixture Signer" }` works where `tapOn: "Copy signing link…"` finds
   nothing. (Found while testing the QR handoff buttons.)
4. **Text containing parentheses is a regex trap** — `Name (sent)` as a
   selector string silently becomes a capture group and never full-matches.
   Use a prefix regex (`"E2E Fixture — Mutual NDA.*"`) or `id:`.

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
- **Below-the-fold elements are invisible to Maestro**: the a11y tree only
  contains the viewport, so a button past the fold is "not found", not
  "not visible". `scrollUntilVisible` (direction: DOWN) before interacting —
  the signer flows use it for the consent row and action bar.
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
