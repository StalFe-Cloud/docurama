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
| F2 | `/modeles-de-contrats` 500s when the DB path is wrong (see F1) — page itself has no try/catch around Prisma | **Fixed**: try/catch + French empty-state card; same class fixed on `/docs/legal` (verified 200 + empty state with a broken `DATABASE_URL`) |
| F3 | `next.config.ts` has `typescript.ignoreBuildErrors: true` | **Fixed**: flag removed; `tsc --noEmit` gate runs in `e2e/run.sh` (step 2b) before every suite and fails the run; production build now enforces types |
| F4 | No public signer-facing signing page yet (recipients get queued mail only) — limits E2E to send/void/verify, no sign-step | **Fixed**: full signer portal shipped (`/sign/{token}`) — see §7 below |

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

## 6c. Cycle 2 — signer portal & platform hardening (executed)

The gap that kept Docurama behind every competitor (F4) is closed, plus
the first two next-cycle items:

- **Public signer portal** (`/sign/{token}`, `sign.docurama.eu`): the 32-byte
  per-recipient token is the authentication. One-page signing experience —
  document card, sender message, signers rail, contract text for
  template-sent envelopes, adopt-signature (typed, 3 handwriting fonts),
  eIDAS consent, sign/decline. Turn order enforced; final signature seals
  the envelope (COMPLETED, SHA-256 via `computeEnvelopeDigest`, B-T) and
  writes SIGNED/SEALED/DECLINED/VIEWED events to the ledger.
- **Invitation emails now carry the personal link**: the send op queues one
  MailOutbox row per recipient (template SIGN_INVITE) with the /sign/{token}
  link — inspectable in the admin console.
- **QR handoff** (roadmap #2): the envelope-detail sheet shows, per pending
  signer, a copy-link button and a QR popover for phone handoff.
- **Signer journey E2E** (next-cycle #1): 4 new flows — sign→seal→public
  verify, decline-with-reason, invalid link, QR/link handoff — plus 2 new
  fixtures (DOC-E2E0003/0004) with deterministic tokens.
- **API-layer suite** (next-cycle #2): `e2e/api.test.ts` (bun test) — key
  auth, scope 403s, verify-engine states, detail reads, sign-endpoint
  validation, and a regression lock that recipient tokens never leak in v1
  payloads. Runs inside `e2e/run.sh`.
- **F3 closed**: `ignoreBuildErrors` removed; tsc gate in the runner + CI.
- **Evidence chain groundwork**: Envelope now carries `templateId` — which
  template produced the signed document is answerable (roadmap #12 base).
- Verify portal accepts `?code=` prefill — the signer success screen links
  straight into the proof ("Verify the seal" button).

## 7. Next-Cycle Candidates

1. ~~Signer journey E2E once the recipient signing page ships (F4).~~ **Done** (cycle 2).
2. ~~API-level layer for v1 endpoints~~ **Done** (cycle 2, `e2e/api.test.ts`). Remaining: MCP endpoint tests, quota-402 test with a spent-plan key.
3. **Visual regression** (screenshot diffing) for marketing surfaces.
4. ~~Remove `ignoreBuildErrors` (F3) and add `tsc --noEmit` gate to CI.~~ **Done** (cycle 2).
5. Performance budget: LCP check on `/` and `/marketing` in CI.
6. ~~**Evidence pack export** (roadmap #1): one-click ZIP per completed
   envelope (sealed document, ledger CSV, signed manifest).~~ **Done** (cycle 3,
   `docs/EVIDENCE-PACK.md` — plus bilingual certificate, offline verifier,
   X.509 evidence key with DNS SAN, and full byte-level test coverage).
7. **PDF embedding in the signer portal** for uploaded-document envelopes
   (currently a document card with integrity digest).
8. ~~Public verification for self-hosted / on-prem instances~~ **Done** (cycle 3,
   attestation protocol — `docs/SELF-HOSTED-ATTESTATION.md`, receiver at
   `/api/attestations`, `VERIFIED_ATTESTED` result in the verify engine).
9. ~~DNS verification beyond SMTP: verified-domain badge on signer portal and
   verify results, SPF/DMARC posture check, domain-bound seals~~ **Done**
   (cycle 3 — `verifiedSenderDomain` recorded at seal time, SAN in the
   evidence-key certificate, `domain.posture` op in settings).

## 7b. Cycle 3 — Evidence pack + self-hosted attestation (2026-09-17)

Branch `feat/evidence-pack` off `quality`. Everything below is shipped with
tests and docs:

- **Evidence pack** (roadmap #1): ZIP per completed envelope — sealed document
  (byte-exact, STORE-method ZIP written in-house, zero deps), event-ledger
  CSV, machine-readable envelope record, bilingual print-ready certificate,
  README, and a **signed manifest** (RSA-SHA-256 over canonical JSON). Export
  surfaces: envelope detail button (`/api/evidence-pack/{id}`, session) and
  `GET /api/v1/envelopes/{idOrCode}/evidence-pack` (API key). Every export is
  ledger-recorded (`EVIDENCE_EXPORTED`).
- **Offline verifier** (`verify.html` inside every pack): browser-only,
  zero-network re-verification of the manifest signature (WebCrypto) and of
  every artifact's SHA-256. Proven in real Chromium by
  `scripts/verify-offline-check.ts` — banner VALID, 7/7 artifacts OK.
- **Evidence key** (`src/lib/evidence-key.ts`): per-tenant RSA-2048 key with a
  self-signed X.509 certificate via system OpenSSL; when the tenant has a
  DNS-TXT-verified sending domain it is embedded as `subjectAltName DNS:` —
  the "DNS verification → verified certificate" chain.
- **Self-hosted attestation** (roadmap #13 groundwork): `EVIDENCE_PORTAL_URL`
  makes an instance push a signed minimal fingerprint at seal time
  (GDPR-minimal: code, digest, dates, conformance, signer count — zero
  personal data). Receiver `/api/attestations` with TOFU key pinning,
  thumbprint/certificate binding, per-code ownership (409), idempotent
  re-push. Verify engine fallback: local envelopes first, then
  `VERIFIED_ATTESTED` with instance registry facts, rendered distinctly in
  the public and in-app verify UIs.
- **Sender-domain trust chain**: seals record `verifiedSenderDomain` when the
  sender's email domain is DNS-verified; the signer portal shows the badge
  (anti-phishing), verify results cite it, evidence packs and attestations
  carry it.
- **Email posture** (`domain.posture`): SPF/DMARC record checks (generic,
  honest) + best-effort DKIM probe, with chips in Settings → Domains.
- **Schema**: `EvidenceKey`, `PortalInstance`, `PortalAttestation` models;
  envelope gains `verifiedSenderDomain`, `attestedAt`, `attestStatus`.
- **Tests**: `e2e/evidence.test.ts` (14 tests — pack byte-level verification
  from raw HTTP bytes, receiver loopback incl. all rejection paths, DNS
  posture parsers), 2 new Maestro flows (`evidence-pack-export`,
  `verify-attested`) → suite now 24 flows. Seed: attested fixture
  DOC-E2EATST + realistic remote-instance registry row + portal-table sweep
  for determinism.
- **Docs**: `docs/EVIDENCE-PACK.md` (format spec v1), 
  `docs/SELF-HOSTED-ATTESTATION.md` (protocol + honest trust limits +
  upgrade paths), API reference updated (evidence-pack + attestation
  endpoints, `VERIFIED_ATTESTED`).

## 6b. Re-validation & hardening (second pass, fresh environment)

The suite was re-validated from scratch in a clean sandbox (fresh `bun
install`, committed `db/custom.db`, cold dev server):

- **18/18 flows green**, including the previously flaky marketing flow.
- Flake fixed for good: on a cold server the first navigation to a route
  races the dev compiler (marketing CTA → `/welcome` once exceeded its 10s
  wait). `e2e/run.sh` now warms the public routes after boot and
  first-navigation waits are 30s.
- Runner improvements: `run.sh` accepts multiple flow paths (run a group:
  `bash e2e/run.sh e2e/flows/public/*.yaml`); same seed/warm-up/report
  behavior as a full run.
- Environment lesson (sandbox, not product): background process groups are
  reaped ~5 minutes after spawn, which masqueraded as a hung flow. Run the
  suite in the foreground (the normal `bun run test:e2e` path) or in chunks.

## 8. Definition of Done (this cycle)

- [x] Maestro installed & web mode validated headless in this environment
- [x] Branch `e2e/maestro-suite` with suite, seed, runner, CI
- [x] All flows green against the dev server in one `bun run test:e2e` (18/18)
- [x] Findings fixed or logged (§5/§6) — 3 product bugs fixed, tsc + eslint clean
- [x] Worklog updated; PR ready for review into `quality`
