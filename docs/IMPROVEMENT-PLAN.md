# Improvement Plan — Cycle 2026-09: Maestro E2E & Release-Quality Baseline

> Branch: `e2e/maestro-suite` (forked from `quality` @ `298ce1d`)
> Owner: Engineering · Status: **In execution**

---

## 1. Context & Problem Statement

Docurama's `quality` branch carries a feature-complete Next.js 16 e-signature
platform: marketing site, auth + onboarding, envelope workspace, admin console,
public verify portal, API v1 + MCP. Verification today is **manual and
ad-hoc**: per-feature Playwright capture scripts (`scripts/qa-*.ts`) that
screenshot pages for human/VLM review, plus API smoke shells
(`test-onboarding-api.sh`, `test-prod-settings-api.sh`).

This has three costs:

1. **No regression net.** Nothing fails when a journey breaks — the hero demo,
   the send-envelope dialog, the verify portal. Defects surface only when a
   human happens to look at a screenshot.
2. **No executable spec.** The README describes behaviour that no test
   enforces; docs and product can silently drift apart.
3. **No CI gate.** Every push to `quality` ships on trust.

The user-mandated direction for this cycle: **use Maestro
(github.com/mobile-dev-inc/Maestro) to perform end-to-end testing**, starting
from the current `quality` state.

## 2. Objectives

| # | Objective | Success criterion |
|---|-----------|-------------------|
| O1 | Maestro E2E suite covering the critical user journeys | ≥ 15 committed flows, all green against the dev server |
| O2 | Deterministic, isolated test data | Idempotent seed script; E2E traffic confined to a dedicated tenant; zero pollution of demo datasets |
| O3 | One-command local run | `bun run test:e2e` boots/uses the dev server, seeds, runs the suite, exits non-zero on any failure |
| O4 | CI gate | GitHub Actions workflow runs the suite on push/PR against `quality` and `main` |
| O5 | Fix what the suite surfaces | Bugs found by flows are fixed or explicitly logged in §6 |

## 3. Environment Findings (validated before writing the plan)

- **Maestro 2.10.0 web mode works in this environment.** ChromeDriver 151 +
  Playwright's "Chrome for Testing" binary, launched headless
  (`maestro test --headless`). The container has no KVM and no X server, so
  Android emulators and headed Chrome are both unavailable — browser flows are
  the correct Maestro strategy here.
- A `chromium` wrapper on `PATH` injects `--no-sandbox --disable-dev-shm-usage`
  (required in unprivileged containers).
- **Env quirk (real bug class #0):** this sandbox exports a global
  `DATABASE_URL` that overrides the repo `.env`, making Prisma open the wrong
  SQLite file and every DB-backed route 500. The runner must pin
  `DATABASE_URL` explicitly — this is now handled in `e2e/run.sh` and documented
  in `.env.example`.
- Maestro `${MAESTRO_*}` env substitution works in the `url:` flow header —
  `MAESTRO_BASE_URL` makes the suite target-portable (local, staging, prod).

## 4. What We're Building

### 4.1 Suite layout

```
e2e/
  README.md            # how to run, how to write flows, selector conventions
  seed.ts              # idempotent Prisma seed: E2E tenant + users + fixtures
  run.sh               # orchestrates: env guard → server → seed → maestro → report
  flows/
    public/            # marketing home, templates, modeles-de-contrats, verify,
                       # docs, developers, status   (no auth)
    auth/              # sign-in (typed + demo buttons), wrong password,
                       # forgot password, sign-out
    workspace/         # documents table, template→send→SENT journey,
                       # envelope detail→void, verify code end-to-end
    admin/             # overview, users directory, platform settings
```

### 4.2 Test data policy

- Dedicated tenant **E2E Testing** (plan: ENTERPRISE, high envelope quota) —
  all flows' writes land there and the seed wipes its envelopes on each run.
- `e2e@docurama.eu` (WORKSPACE_ADMIN, OWNER of the E2E tenant) — used by every
  workspace flow. Demo accounts (`admin@docurama.eu`, `alex@stalfe.example`)
  are **read-only** asserts only (demo-button flow), never used for writes.
- `e2e-admin@docurama.eu` (PLATFORM_ADMIN) — admin flows.
- Fixed-code fixture envelopes (`DOC-E2E0001` SENT, `DOC-E2E0002` COMPLETED +
  sealed) so the verify-portal flow is deterministic without scraping codes
  out of the UI.

### 4.3 Journey coverage matrix

| Journey | Flow file | Asserts |
|---|---|---|
| Marketing home renders, CTA works | `public/marketing.yaml` | hero copy, nav, footer |
| Templates catalog | `public/templates.yaml` | 8 statutory templates, Droit Français badge, Use template CTA |
| French catalog | `public/modeles-de-contrats.yaml` | page renders in French, template cards |
| Verify portal — unknown code | `public/verify-notfound.yaml` | NOT_FOUND result state |
| Verify portal — sealed code | `public/verify-sealed.yaml` | VERIFIED + digest (seeded) |
| Docs / Developers / Status | `public/platform-pages.yaml` | each page's h1 content |
| Sign-in happy path | `auth/login.yaml` | typed credentials → workspace shell |
| Demo one-click buttons | `auth/login-demo.yaml` | DEMO_MODE block, admin entry |
| Wrong password | `auth/login-wrong-password.yaml` | inline error, stays on /login |
| Forgot password | `auth/forgot-password.yaml` | inbox-confirmation screen, back nav |
| Sign out | `auth/logout.yaml` | menu → Sign out → back to sign-in |
| Documents workspace | `workspace/documents.yaml` | header, status tabs, table/search |
| Template → send envelope | `workspace/envelope-send.yaml` | dialog → SENT row visible |
| Envelope detail + void | `workspace/envelope-void.yaml` | detail sheet, signers, void → VOIDED |
| Verify sent code | `workspace/verify-sent.yaml` | NOT_SEALED for fresh SENT envelope |
| Admin overview | `admin/overview.yaml` | KPI cards render |
| Admin users | `admin/users.yaml` | directory + search |
| Admin settings | `admin/settings.yaml` | SMTP/TSA sections render |

### 4.4 Tooling around the suite

- `package.json`: `test:e2e` (full), `test:e2e:seed` (seed only).
- `.github/workflows/e2e.yml`: bun install → prisma generate → seed →
  `maestro test --headless` → JUnit-style report upload on failure.
- The runner tolerates an already-running dev server (CI starts its own).

## 5. Known Issues Found While Setting Up (fix list)

| # | Issue | Status |
|---|-------|--------|
| F1 | `DATABASE_URL` env collision: inherited shell env silently overrides `.env`, all DB routes 500 | Fixed in `e2e/run.sh` + `.env.example` note |
| F2 | `/modeles-de-contrats` 500s when the DB path is wrong (see F1) — page itself has no try/catch around Prisma | To fix: graceful empty-state instead of 500 |
| F3 | `next.config.ts` has `typescript.ignoreBuildErrors: true` | Out of scope this cycle (tsc currently clean; tracked for next cycle) |
| F4 | No public signer-facing signing page yet (recipients get queued mail only) — limits E2E to send/void/verify, no sign-step | Logged as product gap, next cycle |

## 6. Bugs Surfaced by the Suite

Every flow failure was triaged to root cause. Three were **real product
bugs**, all fixed and regression-locked by the suite:

| # | Severity | Bug | Fix |
|---|----------|-----|-----|
| B1 | **Critical** | Opening any envelope's detail sheet white-screened the app (`Cannot read properties of undefined (reading 'map')`). The WS9a security refactor moved `recipients` out of the `envelope` object in the API response, but the sheet still read `env.recipients`. | `user-documents.tsx` reads `detail.data?.recipients`; type updated (`e2e/flows/workspace/envelope-void.yaml` + `documents.yaml` lock it) |
| B2 | High | Row-action buttons (Details / Remind / Void) didn't `stopPropagation()` — every action click ALSO opened the detail sheet underneath, producing two stacked Radix overlays fighting over focus. Real users hit this as "cancel the void dialog → unexpectedly in the detail sheet". | All three buttons stop propagation (`user-documents.tsx`) |
| B3 | Medium | Destructive ConfirmDialog with a required reason auto-focused the **Cancel** button (Radix default) instead of the required input — keyboard users had to tab backwards to type the reason. | `ConfirmDialog` owns `onOpenAutoFocus` and focuses `#confirm-reason` (`shared.tsx`) |
| B4 | Low | Send-dialog recipient inputs had no `id` (only `aria-label`) — ambiguous for automation and styling hooks. | Stable ids `recipient-{n}-name/email` (`user-documents.tsx`) |

Tooling quirks documented (not app bugs): Maestro's per-char `sendKeys`
chokes on **spaces** inside Radix dialogs ("element not interactable") —
flows use hyphenated strings; see `e2e/README.md`.

## 7. Next-Cycle Candidates

1. **Signer journey E2E** once the recipient signing page ships (F4).
2. **API-level Maestro or supertest layer** for v1/MCP endpoints (keys,
   scopes, quota 402s) — currently only curl'd manually.
3. **Visual regression** (screenshot diffing) for marketing surfaces.
4. Remove `ignoreBuildErrors` (F3) and add `tsc --noEmit` gate to CI.
5. Performance budget: LCP check on `/` and `/marketing` in CI.

## 8. Definition of Done (this cycle)

- [x] Maestro installed & web mode validated headless in this environment
- [x] Branch `e2e/maestro-suite` with suite, seed, runner, CI
- [x] All flows green against the dev server in one `bun run test:e2e` (18/18)
- [x] Findings fixed or logged (§5/§6) — 3 product bugs fixed, tsc + eslint clean
- [x] Worklog updated; PR ready for review into `quality`
