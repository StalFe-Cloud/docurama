# Docurama: Self-Host Hardening + EU Cloud SaaS — Design Spec

Date: 2026-09-10
Status: Approved (user-approved master plan)

## 1. Strategy

One codebase, two deployment modes (`DOCURAMA_DEPLOYMENT_MODE=selfhost|cloud`).
Positioning: **"The EU signer"** — sovereign EU hosting, real PAdES-LTA cryptography,
QES via a qualified trust-service partner, fair pricing without envelope starvation,
and a self-host story DocuSign cannot offer.

## 2. Domain strategy

- `docurama.eu` is the primary brand domain. docurama.com is held by Cineverse's US
  documentary-streaming brand (in use since 1999) and is effectively unobtainable;
  `.io` is ruled out because it contradicts the EU-sovereignty pitch.
- Hosts: `docurama.eu` marketing; `app.docurama.eu` SaaS; `*.docurama.eu` tenant
  subdomains (reserved blocklist: www, app, api, mail, sign, verify, trust, notify,
  staging, admin); `verify.docurama.eu` verification portal (QR target);
  `trust.docurama.eu` Trust Center; `notify.docurama.eu` SPF/DKIM/DMARC sending
  subdomain; `staging.docurama.eu` staging.
- Self-host stays at `docurama.stalfe.com`, demonstrating the own-domain story.
- Defensive registrations: docurama.eu + getdocurama.com (redirect) + optionally
  docurama.app. File an EUTM (classes 9/35/42/45) after EUIPO/USPTO clearance.

## 3. Codebase findings driving the design

Strengths to build on: Account/AccountMembership tenancy with a working multi-company
switcher UI; bulk CSV send; contract analyzer; field auto-detection; PAdES sealing with
honest conformance recording (B-B..B-LTA); verification portal; DNS domain attestation
(TXT/CNAME/well-known); per-account SMTP with platform fallback; 2FA + password reset;
webhooks with SSRF guard; in-repo landing page with pricing grid.

Urgent exposures found (drive Phase 0):

| # | Exposure | Location |
|---|----------|----------|
| 1 | Real session JWT tracked in repo | `cookies.txt` |
| 2 | Plaintext GitHub PAT in git remote | git config; `docs/GO_LIVE.md` step 0 |
| 3 | Hardcoded SECRET_KEY that passes the production guard | `docker-compose.engine.yml` |
| 4 | Dev P12 + root CA shipped in repo | `backend/app/certs/` |
| 5 | Open self-registration on the live instance; no password minimum at registration | `backend/app/api/auth.py` |
| 6 | No rate limiting anywhere (incl. unauthenticated `/api/verify/upload`) | API layer |
| 7 | API-key scopes stored but never enforced; every API-key request mutates `user.account_id` | `backend/app/api/auth.py` |
| 8 | Document previews not account-scoped (entropy-only protection) | `backend/app/api/documents.py` |
| 9 | Domain enforcement toggle lacks admin check; two domain endpoints leak org data | `backend/app/api/domains.py` |
| 10 | No CI/CD; no upgrade/backup tooling; deploy scripts hardcode host 212.47.79.52 | `deploy/`, repo root |

## 4. Phase 0 — Secure & stabilize docurama.stalfe.com (~2 weeks)

### 4.1 Day-one security
- Delete `cookies.txt` from the repo; invalidate the session it contains.
- Rotate the GitHub PAT; store credentials properly instead of in the remote URL.
- Rotate prod `DOCURAMA_SECRET_KEY`. Consequence to document: SMTP passwords and TOTP
  secrets are Fernet-encrypted with a key derived from SECRET_KEY and must be re-entered.
- Add the engine-compose shipped key value to the production-guard blacklist in
  `backend/app/core/config.py` so no deployment can boot with it.
- Verify the production P12 was issued on the server via `scripts/issue_signing_cert.py`,
  never the repo dev cert; the dev cert stays usable only in development mode.

### 4.2 Auth & API hardening
- Deployment mode setting (default `selfhost`): selfhost disables public registration by
  default (invite-only; platform admin can re-enable); cloud enables it.
- Password minimum (12 chars) enforced at registration, matching change/reset rules.
- Rate limiting on auth endpoints (login/register/reset/totp) and `/api/verify/upload`
  via slowapi in-process; no new infrastructure.
- Enforce API-key scopes (read/write) at the router level; resolve account context from
  the key without mutating `user.account_id` on every request.
- Admin-role check on domain enforcement toggle; gate
  `POST /api/domains/validate-authentication` and `GET /api/domains/status/{domain}`;
  account-scope preview document rendering.

### 4.3 Operability
- `deploy/upgrade.sh`: tag-pinned deploy over the existing `deploy_to_vps.py` path,
  healthz gate, rollback to previous image.
- `deploy/backup.sh` + `deploy/restore.sh`: pg_dump + storage volume, retention, host
  cron; run and document one restore drill.
- Settings deliverability check: SPF/DKIM/DMARC validation for the configured sending
  domain plus a diagnostic test-send with plain-language results.
- CI (GitHub Actions): pytest, `scripts/audit_clean_room.py`, frontend tsc/vite build,
  image build, `scripts/verify_signing.py` end-to-end crypto check.

### 4.4 Test lift
- HTTP-level endpoint tests (FastAPI TestClient) with multi-tenant fixtures, targeting
  the isolation gaps above; the existing suite is unit/service-only.

## 5. Phase 1 — Cloud foundation + product experience, docurama.eu (~6–8 weeks)

1. Capability layer: deployment mode + registry (registration, billing, quotas,
   subdomains, custom domains); API/UI to grant `is_platform_admin` (flag exists in the
   model with no setter anywhere).
2. Tenant routing: wildcard TLS for `*.docurama.eu`; host→Account middleware resolving
   subdomain and verified custom domains; dynamic host validation replaces the fixed
   `ALLOWED_ORIGINS` list in cloud mode; reserved-subdomain blocklist; per-account
   branding applied on custom domains.
3. Tenant isolation: new artifacts under `storage/accounts/<account_id>/`; DB-stored
   absolute paths keep legacy files readable; account-scoped previews; per-endpoint
   tenant-isolation regression tests.
4. Domain verification UX: auto-detect DNS provider from NS records; provider-specific
   tutorials (Cloudflare, GoDaddy, Namecheap, OVH, Hetzner, Squarespace) with
   copy-paste records; "Email my IT team" button generating a pre-drafted email with
   the records table and verification link; Cloudflare one-click via a DNS-scoped API
   token (Docurama writes the records); no-DNS fallbacks (HTML file, meta tag,
   admin-email click-link); auto-recheck with found-vs-expected diagnostics.
5. Signer verification channels: `VerificationChannel` interface with Email OTP (free,
   default), Telegram Bot (free), WhatsApp Cloud API (near-free: authentication
   messages ~€0.003–0.03; service conversations free and unlimited), real SMS via an EU
   aggregator (paid, Business tier). Wired to the existing `sms` settings section.
6. Onboarding: signup questionnaire (role, use case, volume, team size) → adaptive
   template packs per vertical (HR, Sales, Legal, Real Estate, Finance) → onboarding
   checklist (stamp → first envelope → optional domain verify → invite team → SMTP) →
   cursor-guided tours (react-joyride) → contextual empty states → "first envelope in
   5 minutes" email drip. Signers: zero-account, mobile-first.
7. UI/UX redesign: design tokens + dark mode → component library (repo has ~2
   components and a 3,937-line SettingsPage to decompose) → page-by-page refresh
   (dashboard with insights, builder with snap guides and undo/redo, signing studio,
   ⌘K command palette, keyboard shortcuts).
8. Quotas & metering: Plan model (envelopes/mo, storage, seats); single quota service;
   usage metering hooked on `envelope.created`; per-account rate limits.
9. Billing (Stripe, hybrid): checkout, billing portal, webhooks, dunning; Enterprise
   subscriptions manually invoiced. New `Subscription`/`BillingEvent` models.
10. EU/GDPR + ops: EU-only VPS (Hetzner); DPA + sub-processor page; account data
    export; hard delete with grace period; separate `docurama-eu` compose project and
    staging; deploy scripts parameterized; CI image publishing.

## 6. Phase 2 — Trust program, parity, differentiation (quarterly)

Trust & certification program:
- Free now: CSA STAR Level 1 (CAIQ v4) with public STAR Registry listing; SSL Labs A+;
  Mozilla Observatory A+ (live-linked badges, never static images); security.txt; HSTS
  preload.
- Partner-based: QES through a `QesProvider` abstraction over QTSP APIs
  (candidates: e-signature.eu/Evrotrust, Yousign, Namirial, Skribble); choose an
  AATL-member QTSP so signatures display Adobe's trusted green check at no extra cost;
  surface recorded PAdES conformance levels honestly in product and marketing.
- Client delivery: Trust Center at `trust.docurama.eu`; embeddable "Verified by
  Docurama" seal; per-envelope certificate + QR (already built).
- Later (paid): ISO 27001, SOC 2 Type II.

Parity: signer accounts + personal vault; payments at signing; in-person/kiosk signing;
template merge variables; branded email templates.
Differentiation: QES add-on (per-envelope pass-through pricing, all paid tiers);
advanced audit exports; SSO/SAML + SCIM (Enterprise); EUDI-Wallet readiness watch.

## 7. Pricing

| Tier | Price | Limits | Notes |
|------|-------|--------|-------|
| Free | €0 | 5 envelopes/mo, 1 seat | Unlimited signers/templates, no watermark, email OTP |
| Plus | €9/user/mo annual (€12 monthly) | Fair-use 300 envelopes/user/mo | Branding, custom domain, WhatsApp/Telegram verify, API + webhooks |
| Business | €17/user/mo annual (€21 monthly) | Same envelopes | + SMS verify, audit exports, shared folders, priority support, SSO when shipped |
| Enterprise | Custom | Custom | QES add-on (~€2–4/envelope), SAML/SCIM, self-host license, DPA, SLA |

Signers always free. Every envelope footer: "Signed securely with Docurama — verify free."

## 8. Go-live plan

1. Phase 0 hardening + Trust Center live on stalfe → private-beta credibility.
2. docurama.eu closed beta with 20–50 EU SME design partners across target verticals.
3. Public launch: Product Hunt, HN, EU tech press, LinkedIn.
4. Channel partnerships: accounting firms, HR platforms, real-estate agencies, notaries.
- Demand engines: programmatic SEO comparison pages, free-tier virality via signer
  exposure and the seal widget, template packs as landing pages.
- Unit economics: COGS per envelope is storage cents + free TSA + near-free OTP; QES
  billed at pass-through.
- KPIs: activation (first envelope < 24h), weekly active senders, envelope volume,
  free→paid conversion, logo churn, support tickets per envelope.
- Timeline: weeks 1–2 Phase 0; weeks 3–10 Phase 1 + beta; weeks 11–12 Trust Center,
  polish, public launch; Phase 2 quarterly thereafter.

## 9. Competitive research basis (2026)

- DocuSign: $10–$65/user/mo with 10 envelopes/user/mo caps even on paid tiers.
- DocuSeal: free cloud ~10 docs/mo; Pro ~$20/user/mo; AGPL community self-host edition.
- QES available as single-API integrations from multiple QTSPs; WhatsApp Business API:
  service conversations free, authentication templates ~€0.003–0.03; Telegram Bot API
  free.
