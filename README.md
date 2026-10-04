# Docurama — Enterprise e-Signature & Legal Evidence Platform

> **Historical entity example:** Docurama SAS, Paris; operator verification required
> **Installation context:** Legal entity, jurisdiction and data residency must be verified by the operator; historical company/location examples below are not independently confirmed
> **Evidence features:** SHA-256 digests, signed attestations and transparency records; independent PDF/TSA validation is a release gate
> **Compliance-related configuration:** eIDAS, GDPR and Part 11 features require deployment-specific validation; no certification is claimed

---

## Table of Contents

1. [Executive Summary & Core Value Proposition](#1-executive-summary--core-value-proposition)
2. [Production Deployment Architecture](#2-production-deployment-architecture)
3. [Topology Overview & Network Infrastructure](#3-topology-overview--network-infrastructure)
4. [Subdomain Matrix & Routing / Redirect Architecture](#4-subdomain-matrix--routing--redirect-architecture)
5. [Administrator provisioning and account policy](#5-administrator-provisioning-and-account-policy)
6. [Email System: Inboxes, Logic, Routing & Deliverability](#6-email-system-inboxes-logic-routing--deliverability)
7. [Compliance Certificates, Approvals & Policy Library](#7-compliance-certificates-approvals--policy-library)
8. [Signature Providers, Authorities & Technical Mechanics](#8-signature-providers-authorities--technical-mechanics)
9. [Deployment Tiers: Platform, Enterprise & Self-Hosted](#9-deployment-tiers-platform-enterprise--self-hosted)
10. [Recent Implementations & Platform Enhancements (v1.2.0)](#10-recent-implementations--platform-enhancements-v120)
11. [Key Decisions for Your Confirmation](#11-key-decisions-for-your-confirmation)
12. [Action Items & Operator Tasks Checklist (Tasks to Do for You)](#12-action-items--operator-tasks-checklist-tasks-to-do-for-you)
13. [Operational Runbooks & Commands](#13-operational-runbooks--commands)

---

## 1. Executive Summary & Core Value Proposition

Docurama provides document workflows, tenant workspaces, a public signer portal,
signed evidence exports and transparency records. These features support independent
verification of recorded digests and attestations; they do not by themselves prove
embedded PAdES signatures, qualified signatures or valid RFC 3161 timestamps.
Validate actual completed PDFs and trust chains before making those claims.
Hosting region, subprocessors and outbound integrations determine data residency.
See [security posture](docs/SECURITY.md) and the [release gates](docs/GO-LIVE-CHECKLIST.md).

---

## 2. Production Deployment Architecture

Docurama supports three deployment configurations: **Multi-Tenant Public Cloud**, **Dedicated Enterprise Cloud**, and **Self-Hosted Installation** (an air gap requires separate network and integration validation).

### Architectural Layers

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                      Client Browser                     │
                    └────────────────────────────┬────────────────────────────┘
                                                 │ HTTPS / TLS 1.3
                                                 ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │               Edge Proxy (Caddy / Cloudflare)           │
                    │   - HSTS Preload (63072000s)                            │
                    │   - Automatic ACME Let's Encrypt / ZeroSSL              │
                    │   - Subdomain Hostname Routing & Vanity Redirects       │
                    └───────────┬─────────────────────────────────┬───────────┘
                                │ :3002 (Cloud)                   │ :3003 (Enterprise)
                                ▼                                 ▼
         ┌───────────────────────────────────────┐ ┌───────────────────────────────────────┐
         │         Docurama Cloud Stack          │ │      Docurama Enterprise Stack        │
         │  - Next.js 16 (Turbopack, Standalone) │ │  - Next.js 16 (Turbopack, Standalone) │
         │  - Bun 1.2+ High-Performance Runtime  │ │  - Bun 1.2+ High-Performance Runtime  │
         │  - Worker Threads (OCR & DocIntel)    │ │  - Dedicated Isolated Tenant Context  │
         └──────────────────┬────────────────────┘ └──────────────────┬────────────────────┘
                            │                                         │
                            ▼                                         ▼
         ┌───────────────────────────────────────┐ ┌───────────────────────────────────────┐
         │       SQLite WAL Engine (Cloud)       │ │     SQLite WAL Engine (Enterprise)    │
         │       db/custom.db + shadow indexes   │ │     db/custom.db (isolated storage)   │
         └───────────────────────────────────────┘ └───────────────────────────────────────┘
```

### Technology Specifications

| Component | Technology | Specification / Notes |
|---|---|---|
| **Runtime** | Bun 1.2+ / Node 22 LTS | High-throughput async execution, native worker threads |
| **Framework** | Next.js 16.1.3 (App Router) | Standalone output bundle, React 19, Server Components |
| **ORM & Database** | Prisma + SQLite (WAL mode) | `db/custom.db` with accent-folded shadow search indices (`nameLower`, `titleLower`) |
| **OCR & AI Intel** | Tesseract OCR + AcroForm Engine | Multilingual (French/English) document parsing and field classification |
| **Styling & UI** | Tailwind CSS v4 + Radix UI + shadcn | Responsive, accessible (WAI-ARIA compliant), light/dark theme |
| **Container Engine**| Docker & Docker Compose | Multi-stage scratch build, unprivileged user execution |
| **Reverse Proxy** | Caddy v2.8+ | Automatic Let's Encrypt HTTPS, HTTP/3 QUIC support |

---

## 3. Topology Overview & Network Infrastructure

### Server Fleet Topology

Historical deployment topology follows; verify actual hosting, network boundaries and provider assurances for the selected installation:

| Node / Container | Internal Port | External Binding / Domain | Role |
|---|---|---|---|
| **docurama-cloud** | `3000` | `127.0.0.1:3002` → `docurama.eu`, `*.docurama.eu` | Multi-Tenant Public Cloud production instance |
| **docurama-enterprise**| `3000` | `127.0.0.1:3003` → `docurama.stalfe.com` | Dedicated Enterprise StålFe Cloud instance |
| **Caddy Ingress** | `80`, `443` | `0.0.0.0:80`, `0.0.0.0:443` | TLS 1.3 termination, reverse proxy, security headers |
| **MTA Mail Relay** | `587`, `465` | `mail.docurama.eu` | Dedicated Postfix/DKIM transactional mail submission |

### Security Headers & Edge Policy

All endpoints enforce strict enterprise security headers at the Caddy ingress layer:

```caddyfile
header {
    Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "SAMEORIGIN"
    Referrer-Policy "strict-origin-when-cross-origin"
    Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
    Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https:;"
}
```

---

## 4. Subdomain Matrix & Routing / Redirect Architecture

Docurama features a dynamic host-aware routing system managed via `src/middleware.ts`. Single-origin requests are partitioned automatically based on the incoming `Host` header:

### Subdomain Directory

| FQDN | Target Route | Purpose & Target Audience |
|---|---|---|
| `docurama.eu` | `/` | Apex marketing surface, interactive PAdES live demos, legal templates |
| `www.docurama.eu` | `/` | CNAME alias to apex |
| `app.docurama.eu` | `/` | Enterprise signing workspace: documents, templates, team settings |
| `admin.docurama.eu` | `/admin` | Platform Operator console (13 governance & telemetry sections) |
| `verify.docurama.eu` | `/verify` | Public verification engine (validates `DOC-XXXXXX` and SHA-256) |
| `docs.docurama.eu` | `/docs` | Comprehensive documentation, API guides, legal compliance pack |
| `security.docurama.eu` | `/security` | Security hub, vulnerability disclosure policy, RFC 9116 `security.txt` |
| `status.docurama.eu` | `/status` | Public service health, component uptime, incident history |
| `api.docurama.eu` | `/api` | Public REST API index, OpenAPI specifications |
| `mail.docurama.eu` | `/mail` | Outbound mail relay identification & server documentation |
| `mta-sts.docurama.eu` | `/.well-known/mta-sts.txt` | RFC 8460 strict transport security policy file |
| `docurama.stalfe.com` | `/` | Dedicated Enterprise StålFe production deployment |

### Legacy & Vanity Redirection Logic

To prevent broken links across marketing assets, the middleware permanently handles the following redirects:

- `/sign-in` or `/signin` → **307 Redirect** to `/login` (preserves all query strings, e.g. `?next=/templates`)
- `/sign-up` or `/signup` → **307 Redirect** to `/welcome` (preserves trial parameters, e.g. `?template=...`)
- `/modeles-de-contrats` → Public French contract catalog with direct conversion routing to `/welcome?next=/templates` and `/login?next=/templates`

---

## 5. Administrator provisioning and account policy

Use fresh installation data and the reviewed offline administrator bootstrap in
[INSTALLATION-BOOTSTRAP.md](docs/INSTALLATION-BOOTSTRAP.md). Never use retained
demo databases or shared fixture accounts for production. Account examples in
historical receipts are synthetic test data, not operational credentials.
Store unique credentials in the approved secret manager and enforce administrator
2FA. Tenant creation and invitations must follow the selected deployment mode.


## 6. Email System: Inboxes, Logic, Routing & Deliverability

Docurama specifies 12 official email endpoints adhering to IETF RFC standards and European regulatory requirements:

### Complete Mailbox & Routing Matrix

| Email Address | Mailbox Type | Primary Purpose | Inbound Routing / Forward Target | SLA / Priority |
|---|---|---|---|---|
| **`notifications@docurama.eu`** | Dedicated SMTP Mailbox | Outbound transactional signing links, OTPs, verification emails, tamper alerts | Local SMTP / Relay | **P0 (Critical)** |
| **`admin@docurama.eu`** | Real Mailbox / Forwarder | Infrastructure alarms, certificate expiry, root security notices | `docurama@voiria.com` | **P0 (Critical)** |
| **`support@docurama.eu`** | Shared Support Inbox | Technical support, customer inquiries, signer troubleshooting | Support Helpdesk / Zendesk | **P1 (High)** |
| **`sales@docurama.eu`** | Alias / Forwarder | Enterprise proposals, custom self-hosted contracts, volume licensing | `admin@docurama.eu` | **P1 (High)** |
| **`billing@docurama.eu`** | Alias / Forwarder | VAT receipts, SEPA notifications, invoice disputes | `admin@docurama.eu` | **P1 (High)** |
| **`privacy@docurama.eu`** | Regulatory Alias (DPO) | GDPR Data Subject Access Requests (DSAR/DSR), Article 13/14 inquiries | `admin@docurama.eu` | **P0 (Statutory 30d)** |
| **`legal@docurama.eu`** | Alias / Forwarder | Service agreements, commercial NDAs, formal legal notices | `admin@docurama.eu` | **P1 (High)** |
| **`security@docurama.eu`** | Security Alias | Vulnerability disclosure, bug bounty reports (RFC 9116 security.txt) | `admin@docurama.eu` | **P0 (24h Acknowledge)** |
| **`postmaster@docurama.eu`**| RFC 5321 Mandatory | Mail server bounce notifications, deliverability troubleshooting | `admin@docurama.eu` | **P0 (RFC Standard)** |
| **`abuse@docurama.eu`** | RFC 2142 Mandatory | Spam, phishing, and fraudulent envelope reporting | `admin@docurama.eu` | **P0 (Immediate)** |
| **`contact@docurama.eu`** | Inbound General Alias | General inquiries and partnership communications | `support@docurama.eu` | **P2 (Standard)** |
| **`dmarc@docurama.eu`** | Automated Collector | DMARC aggregate XML (RUA) and forensic failure (RUF) telemetry | DMARC Analyzer Tool | **P2 (Automated)** |

### Deliverability & Authentication Records (DNS)

Historical DNS examples follow; verify actual sending-domain alignment and real inbox delivery before rollout:

- **SPF:** `v=spf1 include:_spf.docurama.eu ip4:51.75.124.20 -all`
- **DKIM:** `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz...` (Selector: `docurama2026`)
- **DMARC:** `v=DMARC1; p=reject; sp=reject; pct=100; rua=mailto:dmarc@docurama.eu; ruf=mailto:abuse@docurama.eu; fo=1; aspf=r; adkim=r`
- **MTA-STS (RFC 8460):** Enforces mandatory TLS on all inbound SMTP traffic (`mode: enforce`, `max_age: 31536000`).

---

## 7. Compliance Certificates, Approvals & Policy Library

The policy library in `src/lib/compliance-library/` and administrative control
records support operator evidence collection. Policies, configuration labels and
successful application tests do not establish eIDAS/QES, Part 11, GDPR, ISO 27001
or SOC 2 certification. Verify the actual implementation, hosting and integrations,
complete independent artifact validation and obtain applicable legal review.
Recovery objectives in policies remain targets until a measured restore drill.
See [security evidence limits](docs/SECURITY.md#5-evidence-chain) and
[production acceptance limits](docs/PRODUCTION-PLAN.md#6-compliance-related-features-and-acceptance-limits).

---

## 8. Signature Providers, Authorities & Technical Mechanics

The implemented path records document and ledger digests, signed attestations and
transparency entries. TSA and certificate settings require independent integration
and output testing; a metadata conformance label is insufficient evidence of an
embedded PDF signature. Rehearse certificate/key rotation, preserve historical
verification material and record approved trust-service dependencies. The acceptance
gate includes a completed PDF, TSA response and certificate-chain validation.

---

## 9. Deployment Tiers: Platform, Enterprise & Self-Hosted

| Feature | Platform Cloud (SaaS) | Enterprise Private Cloud | Self-Hosted Appliance |
|---|---|---|---|
| **Target URL** | `https://docurama.eu` | `https://docurama.stalfe.com` | `https://docurama.internal.corp` |
| **Multi-Tenancy** | Shared multi-tenant | Dedicated mode | Dedicated mode; air-gap validation required |
| **Port on Host** | `3002` | `3003` | Configurable (`3000` / `80` / `443`) |
| **Database** | SQLite WAL (`db/custom.db`) | SQLite WAL (dedicated volume) | SQLite or PostgreSQL |
| **Branding** | Docurama Standard | White-label / StålFe Custom | Fully customizable |
| **BYO Certificates** | Configuration by plan | Validate certificate integration | Validate local PKI/HSM integration separately |
| **Updates** | Reviewed immutable release | Reviewed synchronized release | Reviewed image/revision and migration rehearsal |

---

## 10. Platform Enhancements & Architectural Advancements (Cycles 1–11)

The following feature inventory and receipts describe historical engineering cycles. They do not establish current production readiness or an independent audit:

1. **Quality Hardening Release (Cycle 11, 2026-09-20/21, quality @ `34086af`):**
   - **Versioned database migrations** replace boot-time schema pushes: the container entrypoint runs `prisma migrate deploy` against reviewed migration trees (SQLite and PostgreSQL, with `release-20260920.prisma` as a baseline reference; existing databases require deliberate offline comparison and reviewed history reconciliation), refuses to start when migrations fail, and only skips schema work with an explicit operator opt-in. The old silent `db push --accept-data-loss` startup is gone.
   - **Delivery reliability:** transactional webhook outbox with fenced leases, stable delivery identities across retries, and an SSRF-pinned transport (`safe-webhook-http.ts`) that validates destinations at registration and blocks private addresses in production.
   - **Billing correctness:** atomic quota reservation at envelope creation, independent UTC monthly periods, serialized rollover accounting, and transactional payment replay guards.
   - **Mail hardening:** leased outbox delivery with an explicit attempt budget, fenced acknowledgements, and stable message identity across retries.
   - **Runtime safety:** bounded database-transaction admission (`transaction-gate.ts`) without blocking the event loop, worker-loop startup/shutdown fencing, versioned salted password hashing, and stable audit identity that no longer fabricates client IPs.
   - **Verification:** new release-verification and webhook-network CI workflows with the recorded evidence pack (`docs/QUALITY-VERIFICATION-20260920.md`); the full matrix (static gates, SQLite e2e incl. browser and SeaweedFS, PostgreSQL tier, production image build/boot/bootstrap) validated locally on Windows via Docker; GitHub Actions validation pending restoration of the account's Actions billing.
2. **Historical Maestro Browser E2E Automation Suite (Cycle 1):**
   - Current browser coverage uses Playwright in `e2e/browser/`; see `e2e/README.md` for the safe runner. The cycle receipts below describe historical revisions.
   - 25 end-to-end browser flows verifying the entire user journey: authentication, document drafting, template instantiation, multi-recipient handoffs, decline workflows, and administrative console operations.
   - Deterministic fixtures seeded in `e2e/seed.ts` with strict type gates (`tsc --noEmit`) and visual regression baseline comparisons.
2. **Public Signer Portal & Core Signing Loop (Cycle 2):**
   - Responsive, zero-friction signer journey at `/sign/[token]` requiring no account creation.
   - Dual-mode signature execution: biometric freehand canvas drawing or SVG-rendered cryptographic type-to-sign fonts (Dancing Script, Great Vibes, Caveat).
   - In-app signer decline workflow with statutory audit event logging and sender notifications.
3. **Evidence Pack Export & Attestation Federation (Cycle 3):**
   - One-click `.zip` evidence archive generation via `src/lib/evidence-pack.ts` containing the sealed PDF, canonical JSON audit trail manifest, SHA-256 certificate chains, and an offline zero-dependency HTML verifier (`verify.html`).
   - Cross-instance public portal attestation loopback (`/api/attestations`) allowing sovereign self-hosted instances to federate minimal verification fingerprints without exposing document contents.
4. **Certificate Transparency (CT)-Style Append-Only Registry (Cycle 4):**
   - Cryptographic Merkle/hash-chain registry (`src/lib/transparency.ts`) recording every seal commitment with SHA-256 links to preceding block headers.
   - Public inclusion proofs (`GET /api/transparency/proof/{code}`) and signed checkpoints (`GET /api/transparency/checkpoint`) enabling third-party monitors to detect rewrite attacks or log truncation without central trust.
5. **Embedded Document Preview Engine (Cycle 5):**
   - High-fidelity PDF page rasterizer (`/api/sign/[token]/pages/[n]`) allowing signers to review full document typography, layouts, and statutory clauses before executing signatures.
6. **Sigstore Rekor Neutral Third-Party Witnessing (Cycle 6):**
   - Cryptographic integration with OpenSSF's public Rekor transparency log (`src/lib/rekor.ts`).
   - The portal transparency key signs a self-commitment statement (`docurama-portal-key-witness-v1`), submitted to `rekor.sigstore.dev` as a `hashedrekord`. Checkpoints embed the Rekor entry UUID, log index, and inclusion proof, eliminating single-operator trust.
7. **Per-Recipient Preview Watermarking & MCP Server (Cycle 7):**
   - Dynamic canvas watermarking (`CONFIDENTIAL - REVIEW ONLY`) stamped on document preview pages with recipient email and timestamp, deterring unauthorized pre-signature distribution.
   - Key-authenticated Model Context Protocol (MCP) server at `/api/mcp` for LLM agents to programmatically query envelope status, audit logs, and compliance records.
8. **Production Deployment Readiness & Hardened Packaging (Cycle 8):**
   - Comprehensive `/api/health` probe evaluating SQLite/PostgreSQL connectivity, object storage readiness, SMTP relay status, webhook dispatch queues, and Rekor connectivity.
   - Hardened non-root container image (`uid 10001 docurama`), reviewed provider-specific boot-time migrations with fail-closed startup (`docker-entrypoint.sh`), and enterprise Helm charts (`deploy/helm/docurama`).
   - Postfix/SMTP retry daemon with exponential backoff and HMAC-SHA256 signed webhook delivery engine.
9. **S3-Compatible Scalable Object Storage (Cycle 9):**
   - Native dual-engine document store supporting local POSIX storage or S3-compatible backends (Apache-2.0 SeaweedFS, MinIO, Ceph, AWS S3, Cloudflare R2).
   - Real SeaweedFS test integration in CI and Docker Compose (`--profile s3`).
10. **Repriced Commercial Catalogue & Guided Onboarding (Cycle 10, final ladder):**
    - Five-plan catalogue: SOLO 1-seat €12/mo · 50 envelopes, STARTER 3-seat €19/mo · 50 envelopes (same allowance as Solo), SMART TEAM 10-seat €79/mo · 250 envelopes, BUSINESS 50-seat €199/mo · 1,000 envelopes, ENTERPRISE custom.
    - Unused envelope rollover on renewal, committed-term billing discounts, and small team organizational groups.
    - Public `/enterprise` intake pipeline (`/api/enterprise-lead`) with platform admin triage console.

---

## 10b. Go-Live Cycle (feat/go-live-platform)

Everything needed for 100% public launch, on top of cycles 1–10:

- **Final commercial ladder** — Solo €12 (1 seat) · Starter €19 (3 seats, same 50-envelope allowance as Solo) · Smart Team €79 (10 seats, 250) · Business €199 (50 seats, 1,000) · Enterprise custom. Rendered from one source (`src/lib/plans.ts`) across the marketing grid, admin console, Settings → Billing, seed data, Product/offers JSON-LD, i18n and the test suite.
- **Payment rails** — Stripe Checkout (subscription mode: the chosen term charged automatically every term) with signature-verified webhooks (`checkout.session.completed` activation, `invoice.paid` renewal with rollover, `invoice.payment_failed` → PAST_DUE + dunning, `customer.subscription.deleted` → CANCELED), plus a **manual bank-transfer mode** for self-host/out-of-band deployments: tenants request activation with a quotable reference, platform admins approve in the admin console, and both modes run the identical activation path. Operator guide: `docs/PAYMENTS.md`.
- **Single sign-on** — OIDC (Microsoft Entra ID, Google Workspace, Okta, Keycloak; discovery + PKCE + nonce + JWKS verification) and SAML 2.0 (samlify SP, SP metadata endpoint, signature-verified ACS), bound to the company email domain, one active connection per domain, JIT-provisioned members with unusable passwords. The sign-in screen offers the IdP path as soon as a typed email matches. Operator guide: `docs/SSO.md`.
- **Bot protection** — honeypot + time trap + optional Cloudflare Turnstile on every public form (signup, enterprise lead).
- **Knowledge base & tutorials** — the `/docs` site covers every section (19 new articles: billing, teams, account & security, self-hosting, troubleshooting, templates, domains, notifications, webhooks, MCP + 2 step-by-step tutorials) with real markdown rendering.
- **Blog** — `/blog` with the six launch posts, SEO (JSON-LD Blog/BlogPosting, sitemap entries, canonicals).
- **Internal runbooks** — `docs/OPERATIONS-RUNBOOK.md`, `docs/DEPLOYMENT.md` (Vercel / Docker / Compose / Helm + full env reference), `docs/SECURITY.md`, `docs/PAYMENTS.md`, `docs/SSO.md`, and the master `docs/GO-LIVE-CHECKLIST.md`.
- **Trust surfaces** — `/.well-known/security.txt` (RFC 9116), Product/offers structured data.
- **Verification** — 149 bun tests across 13 suites (four new: billing 14, SSO 12, bot-guard 10, plans rewritten to the final ladder) and 29 Maestro flows (two new: blog, settings-billing). tsc/eslint/production build clean; 37 routes build.

## 11. Key Decisions for Your Confirmation

1. **Header Navigation Decluttering:**  
   "Contract Templates" was removed from the crowded top navigation bar and relocated into the marketing footer (under *Product* and *Legal & Trust*) as well as the homepage feature bento. This creates a clean, balanced enterprise header.
2. **French Statutory Contract Integration:**  
   All 8 statutory French legal templates (`isBuiltIn: true`) are now directly embedded in the in-app `/templates` catalog with a distinct **Droit Français** statutory badge, categorization, and a direct "Use template" workflow into the New Envelope dialog.
3. **Permanent Vanity Auth Routing:**  
   To eliminate 404 errors on legacy links or external bookmarks, `/sign-in` permanently redirects to `/login` and `/sign-up` permanently redirects to `/welcome`.
4. **SQLite WAL Architecture vs PostgreSQL:**  
   For workloads under 100,000 active envelopes/month, SQLite in WAL mode provides instantaneous queries, sub-millisecond transactions, zero external network latency, and simple zero-dependency backups. The codebase provides a direct migration path to PostgreSQL for multi-region clustering.

---

## 12. Action Items & Operator Tasks Checklist (Tasks to Do for You)

Complete the [go-live checklist](docs/GO-LIVE-CHECKLIST.md) for the pinned candidate
and chosen edition. Record engineering results separately from DNS/TLS, SMTP,
IdP/CAPTCHA, payments, legal review and independent PDF/TSA acceptance.
Provision fresh administrator accounts offline, protect configuration in the
approved secret store, and exclude fixture accounts and demo mode from production.
Record backup/restore evidence, migration compatibility, RPO/RTO and release/incident
owners before cutover. External activation and deployment are separate operator actions.

---

## 13. Operational Runbooks & Commands

Use [deployment](docs/DEPLOYMENT.md) for provider-specific build and reviewed
`migrate deploy`, including the deliberate offline baseline process for existing
databases. Keep runtime storage outside the checkout and create fresh administrator
credentials through [offline bootstrap](docs/INSTALLATION-BOOTSTRAP.md).
Use [E2E guidance](e2e/README.md) for disposable synthetic tests, and
[operations](docs/OPERATIONS-RUNBOOK.md) for recovery and monitoring.
Promotion requires an immutable reviewed image/revision, successful migration and
restore rehearsal, and completed [go-live gates](docs/GO-LIVE-CHECKLIST.md).

---

*© 2026 Docurama SAS · 1 Rue Marguerin, 75014 Paris, France · All rights reserved.*
