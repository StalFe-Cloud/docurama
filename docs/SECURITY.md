# Security Policy & Posture — Docurama

Internal document. Covers the shipped posture, the controls an operator inherits, and what self-hosters must do themselves. Public-facing disclosure policy: `https://security.<root>` + `/.well-known/security.txt` (RFC 9116).

## 1. Threat model (summary)

Docurama signs and seals business documents; the assets are (a) document confidentiality, (b) signature/evidence integrity, (c) tenant isolation, (d) account takeover. Primary adversaries: credential stuffing against the portal, forged signing links, webhook/API abuse, and a compromised host. Mitigations map to: revocable sessions + 2FA (§3), unguessable per-recipient tokens + domain-bound SSO, hashed API keys + scoped endpoints + signed webhooks, and the evidence chain (§5).

## 2. Security headers (shipped in next.config.ts)

| Header | Value |
|---|---|
| Content-Security-Policy | `default-src 'self'`; production drops `unsafe-eval` (dev-only, React refresh); `object-src 'none'`; `frame-ancestors 'none'` |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| Cross-Origin-Opener-Policy | `same-origin` |
| Cache-Control on `/api/*` | `no-store, max-age=0` |

Verify after deploy: `curl -sI https://app.<root>/ | grep -iE 'content-security|strict|frame|opener'` — no `unsafe-eval` in the production CSP.

## 3. Authentication

- **Sessions:** server-side `Session` table — revocable, 7-day expiry, device/IP metadata. Logout revokes server-side; cookies are HttpOnly with CHIPS attributes on HTTPS, plus a Bearer fallback for hostile cookie contexts.
- **TOTP 2FA:** real RFC 6238 (zero deps, ±1-step window), 10 one-time recovery codes stored as SHA-256 hashes. Org-wide enforcement via `Tenant.enforceTwoFactor`; admin op `force-2fa` per user.
- **SSO (OIDC):** discovery-driven authorization-code flow with **PKCE (S256)** and **nonce**; `id_token` verified via `jose` against the IdP's JWKS (issuer + audience checked, nonce mismatch = replay rejected).
- **SSO (SAML):** samlify with signature verification enforced; the SP is domain-bound and connections are per-email-domain (one ACTIVE connection per domain).
- **JIT provisioning:** unknown-but-domain-matching users are created ACTIVE, `emailVerifiedAt` set, MEMBER role, with an unusable password hash (`sso!` + random hex) — password login stays available for non-SSO users, and SSO-created accounts can set a password only through reset-password.
- **Transaction cookies:** `docurama_sso_txn` carries state + PKCE verifier + nonce, HMAC-SHA256-signed via `SSO_TXN_SECRET` (10-minute Max-Age, HttpOnly, SameSite=Lax; tamper → rejected).

## 4. Bot protection & API security

**Public forms** (signup, enterprise lead, password reset) are guarded by three server-side layers (src/lib/bot-guard.ts), zero client trust: (1) a honeypot `website` field — any content = 403; (2) a 2.5 s time trap on `formStartedAt` (skipped only when `NEXT_PUBLIC_DEMO_MODE=true`; a forged future timestamp or a missing field is also rejected); (3) optional Cloudflare Turnstile when `TURNSTILE_SECRET_KEY` is set — fail-closed when configured. Per-IP rate limiting is per-route on top.

**API keys:** `X-API-Key` values are SHA-256 hashed at rest and shown exactly once at creation; keys carry scopes (ENVELOPES / TEMPLATES / FULL — a wrong-scope key gets 403) and per-key rate limits; the MCP server (`/api/mcp`) adds its own per-key rate limit with per-tenant enable/allowlist. Outbound webhooks are HMAC-SHA256-signed (`X-Docurama-Signature` over the raw body) with the secret revealed once; endpoints are https-only (loopback excepted).

## 5. Evidence chain

Every sealed envelope gets: a SHA-256 document/ledger digest (`computeEnvelopeDigest`, src/lib/esign.ts), PAdES sealing (B-B on lower plans, B-LT/B-LTA on higher tiers), RFC 3161 timestamps from HTTPS-only TSAs (http:// TSAs are rejected at validation; catalog includes Sectigo/DigiCert/GlobalSign/FreeTSA presets), an append-only transparency log, and optional Sigstore **Rekor witnessing** of the portal key (`REKOR_API_URL`, disable with `REKOR_WITNESS=off`). The per-tenant evidence key is a real RSA-2048 self-signed cert (SAN-embedded DNS-verified domain) with TOFU pinning on the portal — regenerating it is a deliberate key-rotation event. **Evidence packs verify offline**: digests, timestamps and signatures check out without access to Docurama infrastructure (see docs/EVIDENCE-PACK.md).

## 6. Data protection

EU residency end-to-end (Docurama SAS, Paris; EU hosting and EU TSAs). DSAR tooling in the admin console (Legal & DSAR section: run/cancel, DMCA resolution with recorded notes). Retention policies and legal holds are first-class models (per-tenant retention rules, hold-scoped purge suppression). Consent records (GDPR Art. 7) are captured at signup with versioned references.

## 7. Incident response

| Severity | Trigger | Clock |
|---|---|---|
| SEV1 | Confirmed data breach, total sealing outage | Crisis cell ≤ 30 min; CNIL within 72 h (Art. 33) |
| SEV2 | Contained serious incident | Same-day containment write-up |
| SEV3 | Minor/cosmetic | Ticketed |

All incidents are tracked in the Incident ledger (rendered on `/status`). Audit expectations: `AuditEvent`/`SecurityEvent` rows are append-only records of every mutation (actor, IP, severity); the audit chain status is visible in the admin console — treat any chain gap as SEV2. External reports flow to **security@docurama.eu**; triage and safe-harbor commitments are published on the security page.

## 8. Operational security checklist (self-hosters)

- [ ] **Set `SSO_TXN_SECRET`** to a strong random value (the derived fallback is per-instance, not a secret).
- [ ] `NEXT_PUBLIC_DEMO_MODE` unset or `false` (the Dockerfile ships it off).
- [ ] Real **Postgres** for multi-replica; SQLite = single replica only, on a PVC/host mount.
- [ ] **TLS everywhere**: reverse proxy or ingress TLS; `smtps://` or STARTTLS relay; `https://` TSAs only.
- [ ] **Restrict admin console access** (`/admin`, platform-admin accounts) — network-restrict the host, enforce 2FA on every admin, keep the admin count minimal.
- [ ] **Encrypt backups**: `scripts/backup.sh --gpg <recipient>` + off-site `--remote`.
- [ ] Rotate the Stripe webhook secret and API keys on staff change; webhook secrets and API keys are shown once.
- [ ] Review `AuditEvent` and `SecurityEvent` feeds weekly; watch `/api/health` `checks.webhooks.failing`.
