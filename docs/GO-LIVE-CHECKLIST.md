# Go-Live Checklist — Docurama (all platforms)

Master gate. Every box ticks before launch day; sign-off per section. Companion runbooks: `DEPLOYMENT.md`, `OPERATIONS-RUNBOOK.md`, `PAYMENTS.md`, `SSO.md`, `SECURITY.md`.

## 1. Product & content

- [ ] Pricing ladder verified end-to-end: **Solo €12 / Starter €29 / Business €79 / Enterprise custom** (no published price, seats or volume); free trial on Solo only; term switch −5/−10/−20% math correct (e.g. Starter 12 mo = €278.40); no "most popular" badges. Negotiated Enterprise overrides are delivered: a WON lead converts to a tenant whose subscription carries `seatLimitOverride` / `envelopeLimitOverride` / `monthlyEurOverride`, and `src/lib/billing.ts` enforces those over the catalogue (admin op `lead.convert`; `e2e/lead-conversion.test.ts`). The pricing ladder itself still needs end-to-end verification.
- [ ] Legal pages reviewed by counsel: `/privacy` (processing mapped to the real data model), `/terms` (billing terms incl. 35-day months + rollover cap), DPA route to legal@.
- [ ] Cookie notice present (informational, no tracking).
- [ ] Organization JSON-LD valid (rich-results test), canonical + OG metadata on all public pages.
- [ ] `sitemap.xml` and `robots.txt` correct (portal surfaces, `/sign`, `/reset-password`, `/api/sign`, `/api/enterprise-lead` disallowed).
- [ ] Blog live and reachable; knowledge base complete (all 11 guide sections at `docs.<root>`); tutorials/demos pass on desktop + mobile.

## 2. Engineering gates

- [x] `bunx tsc --noEmit` clean (0 errors — the build enforces types; gate also runs in CI, `scripts/ci-over-ssh.sh`).
- [x] `eslint` clean.
- [x] Production build green — CI `production-image` builds the image and boots it against an empty scratch database, asserting `/api/health` and a rendered `/blog`. (A local `bun run build` needs network for `next/font/google`; the containerised build is the authoritative gate.)
- [x] Full E2E battery green via `bash e2e/run.sh`: the Playwright browser suites (`e2e/browser/`, 30 tests covering the 29 journeys that were Maestro flows) + `api`, `evidence`, `transparency`, `rekor`, `mcp`, `plans`, `webhooks`, `visual`, `mail`, `billing`, `sso`, `bot-guard`, `lead-conversion` suites (S3/SeaweedFS suite runs in CI or where a `weed` binary exists).
- [x] PostgreSQL runtime gate green — CI `postgres` generates the PostgreSQL client, seeds, boots the app against PostgreSQL 16 and runs the HTTP + browser suites against it.

> Section 2 is the only section engineering can sign off alone. Sections 3–7
> need credentials, DNS, counsel review and staffed inboxes.

## 3. Cloud SaaS (docurama.eu)

- [ ] DNS: apex, `www` → apex redirect, `app.`, `docs.`, `verify.`, `status.`, `security.`, `mta-sts.` (+ `sign.`, `mail.`, `api.`, `admin.`), all resolving; MX/SPF/DKIM/DMARC/MTA-STS/TLS-RPT/CAA published.
- [ ] TLS certs valid on every host (auto-renew on).
- [ ] Database deployment selected and restore-tested. SQLite is the single-node default. **PostgreSQL is now supported**: build with `DB_PROVIDER=postgresql`, which generates the provider-specific Prisma client (`scripts/schema-for.mjs`); CI's `postgres` job boots the app against PostgreSQL 16 and runs the HTTP and browser suites, so runtime evidence exists beyond the schema check. See `DEPLOYMENT.md` §2.1. Restore-testing is still outstanding, and PostgreSQL alone does not permit multi-replica — see the worker note in §3 below.
- [ ] **S3** storage block set + bucket lifecycle policy; `/api/health` reports `storage.backend: "s3"`.
- [ ] `SMTP_URL` real credentials; **SPF/DKIM/DMARC verified on every sending domain**; test mail lands in Gmail/Outlook inboxes (not spam).
- [ ] Stripe **live**: `bun scripts/stripe-setup.ts --origin https://app.docurama.eu --webhook-url https://app.docurama.eu/api/billing/webhook` with the live (restricted) key → catalog, portal configuration and webhook endpoint (10 events, see `PAYMENTS.md` §5); `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` in the VPS `.env`; `/api/health` shows `checks.billing.ready: true`; then the `PAYMENTS.md` §8 live verification (purchase, plan change, refund, cancel).
- [ ] Stripe **account settings** (shared with NEXA): Stripe Tax head office + registrations (then `STRIPE_AUTOMATIC_TAX=true`), SEPA Direct Debit enabled in payment methods, customer emails/receipts and Smart Retries reviewed, public business name/support contact set. TRIAL workspaces whose trial already ended reviewed before enabling (they must pay on next send).
- [ ] Turnstile keys set (`TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY`).
- [ ] `SSO_TXN_SECRET` set (strong random).
- [ ] `DOCURAMA_KEY_ENCRYPTION_KEY` set (32 random bytes, `openssl rand -hex 32`), stored outside the database and backed up with it: seal-certificate keys are encrypted under it, and customers cannot import a CA-issued seal certificate without it. Losing it makes those keys unusable (seals fall back to the evidence key).
- [ ] RFC 3161: Admin > Settings TSA saved (the save issues a test timestamp); `SEAL_TIMESTAMPS` unset. Sealed PDFs reach PAdES B-T only while it answers, and B-LTA when the certificates' OCSP/CRL services answer too.
- [ ] The worker runs (`DOCURAMA_WORKER` not `off` on one instance): it retries PDFs left at B-T/B-LT and renews B-LTA archive timestamps before their TSA certificate expires. Outbound HTTP to the TSA, OCSP, CRL and CA-issuer URLs must be allowed from the app host.
- [ ] Optional, for PDFs that open "trusted" in Acrobat: a Docurama organisation seal certificate from a CA on the Adobe Approved Trust List (or a QTSP seal certificate), imported per workspace in Settings > eSign. Without it the workspace evidence key signs (integrity and time verify; the identity shows as not yet trusted).
- [ ] `ROOT_DOMAIN=docurama.eu`; `EVIDENCE_PORTAL_URL` set if federating attestations.
- [ ] Backups scheduled (DB + object storage snapshots + retention); restore drill done once pre-launch.
- [ ] Monitoring on `/api/health` (200/503 alerting) and `/status`; `DOCURAMA_WORKER` on exactly one instance if scaled out.

## 4. Private cloud (compose / single host)

- [ ] Deployed per `DEPLOYMENT.md` §2 (compose, storage profile chosen, Caddy/nginx TLS in front).
- [ ] Mail relay configured and tested (`SMTP_URL`) — or outbox-only mode consciously chosen.
- [ ] Manual billing mode active (default); billing inbox (billing@) staffed for bank-transfer approvals.
- [ ] Admin accounts created (no shared logins), 2FA enforced on all of them; admin surface network-restricted.
- [ ] Backup cron + off-site target verified.

## 5. Enterprise self-host (Helm)

- [ ] `deploy/helm/docurama` values reviewed: database matching the generated client, own **S3** (creds via `s3.existingSecret`), own **SMTP**, ingress + TLS, `rootDomain` set.
- [ ] Replica policy: single replica for the SQLite image. A PostgreSQL build (`DB_PROVIDER=postgresql`) is validated at runtime in CI, but multi-replica **still requires worker coordination** — mail and webhook retries run in-process, so exactly one replica may have `DOCURAMA_WORKER` enabled. Externalising or leader-electing that worker is the remaining blocker to horizontal scale.
- [ ] Initial administrator provisioned offline per `INSTALLATION-BOOTSTRAP.md`; first tenant created and company domain verified. Configure **tenant-owned SSO** per `SSO.md`, then complete a real IdP login/replay/2FA acceptance test. Platform-wide SSO connections are rejected.
- [ ] `EVIDENCE_PORTAL_URL` set if pushing attestations to the central verification portal (or run the portal locally).
- [ ] **Backup + restore drill completed on the cluster** (PVC snapshots or `scripts/backup.sh` in a CronJob); RPO/RTO documented.
- [ ] Network segmentation: admin/portal ingress rules, egress allow-list for TSA + IdP + SMTP + S3.

## 6. Launch day

Smoke test, in order, on production:

1. Signup → verification email received → onboarding completes.
2. First envelope: upload/send → signer link opens (public signer portal) → sign → **seal**.
3. Verify: public portal (`verify.<root>`) shows **VERIFIED** + SHA-256 digest + signers.
4. Evidence pack export opens offline and validates.
5. `/status` green; `/api/health` 200.

Support inboxes staffed: **support@, sales@, billing@, privacy@, security@, abuse@, postmaster@** (plus notifications@ sender monitored for bounces).

## 7. Post-launch (first two weeks)

- [ ] Watch the **PAST_DUE queue** daily (admin Billing) — dunning mails flowing, retry-payment only after settled invoices.
- [ ] Watch outbox **FAILED** rows (terminal after 5 attempts) and mail latency.
- [ ] Watch **webhook delivery failures** (`checks.webhooks.failing`, delivery log; 1 m/5 m/15 m/30 m retry schedule).
- [ ] Confirm **transparency checkpoints** and Rekor witnessing stay current (`checks.rekor.witnessed: true`).
- [ ] Error-rate review: server logs for 5xx, admin Ops Health trends, security-event feed for anomalies.
- [ ] Retro at day 14: pricing funnel, incident count, checklist corrections folded back into this document.
