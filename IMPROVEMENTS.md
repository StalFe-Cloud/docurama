# Docurama — Pre-Launch Improvement Audit

**Repository:** `StalFe-Cloud/docurama` @ `main` (HEAD `35e102e`) · **Audit date:** 2026-09-12
**Scope:** Security & auth · Code quality · DevOps & deploy · Testing & CI · Frontend & UX · Performance
**Lens:** Production launch readiness for both **selfhost** and **multi-tenant cloud SaaS** modes
**Method:** 4 parallel deep-review agents (backend, security, frontend, DevOps) + independent verification of every critical finding + live execution of the test suite and frontend build. All `file:line` references below were read from actual code on `main`.

---

## 1. Executive Summary

Docurama has a genuinely solid architectural core: a clean-room PAdES pipeline (pyHanko + PKCS#12 + RFC-3161 timestamps) that *honestly reports* the conformance level it actually achieved, per-tenant storage layout validation, an advisory-lock-guarded reminder sweeper, real HTTP-level integration tests, and no committed live secrets. That is well above the baseline of typical pre-launch SaaS repos.

However, the audit found **3 confirmed critical security flaws, one legally dangerous fake feature, and one deployment model that silently breaks a flagship feature** — all of which should block a public launch. Around those sit ~90 additional findings organized below as P0–P3.

### Headline findings

| # | Finding | Where | Verified |
|---|---------|-------|----------|
| 1 | **2FA is bypassable** — the MFA challenge JWT is accepted as a full session token | `backend/app/api/auth.py:503,232-244` | ✅ by re-reading code |
| 2 | **Any signer receives every other signer's bearer token** → can sign as anyone | `backend/app/schemas/schemas.py:233` + `signing.py:130-136` | ✅ |
| 3 | **Path traversal / arbitrary file read** in the backend SPA fallback | `backend/app/main.py:148` | ✅ |
| 4 | **Fake "WebAuthn / Biometric Passkey" signing** — a 650 ms timer draws "FIDO2-L2 HW-ASSERTION CERTIFIED" onto legal documents | `frontend/src/pages/SigningStudioPage.tsx:351-395` | ✅ |
| 5 | **Production signing key baked into Docker images** (`COPY backend/certs/`) | `backend/Dockerfile:22`, `Dockerfile:44` | ✅ |
| 6 | **Mobile hand-off (scan-to-sign) broken ~50% of the time** — in-memory WebSocket manager + `--workers 2` | `backend/app/api/ws.py:38-63`, `backend/Dockerfile:44` | ✅ |
| 7 | **CI exists but never runs** — malformed YAML: `branches: ain]` instead of `branches: [main]` | `.github/workflows/ci.yml:5` | ✅ |

### Live test & build evidence (executed during this audit)

| Check | Result |
|-------|--------|
| `pytest tests` (backend, real run) | **391 passed, 2 failed** in 18.2 s — both failures are environmental: tests write to the hardcoded default `STORAGE_DIR=/opt/docurama/storage` (`config.py:74`) instead of a tmp path |
| `npm run build` (tsc + vite) | **Passes**, but ships a single **539.86 kB** JS chunk (no code splitting) |
| CI | Workflow file exists but the push trigger is malformed (`branches: ain]`) → **never runs on `main`**; also no frontend build job, no docker build, no security scan |
| TODO/FIXME hygiene | Clean — zero TODO/FIXME/HACK comments in the frontend |
| Committed secrets | No live credentials found; one weak default DB password fallback in `docker-compose.engine.yml:15,33` |

---

## 2. P0 — Launch Blockers (fix before any public traffic)

> These are ordered: 1–2 are exploit-class security holes, 3 is legal/brand risk, 4–6 are integrity/operations.

### P0-1 · TOTP second factor is fully bypassable — CRITICAL
`_issue_mfa_challenge` mints `claims={"purpose": "mfa_challenge", ...}` (`auth.py:503`), but `get_current_user` (`auth.py:232-244`) decodes **any** token signed with `SECRET_KEY` and reads only `sub` — it never checks `purpose`. The challenge token is returned in the login JSON body, so an attacker who knows only the *password* calls `POST /auth/login`, takes `challenge_token`, and uses it as `Authorization: Bearer …` against every endpoint (envelope download, SMTP settings, API keys) for its full TTL. **2FA enrollment is currently decorative.**

```python
# app/api/auth.py — inside get_current_user, after decode_access_token:
purpose = payload.get("purpose")
if purpose and purpose != "session":
    raise HTTPException(401, "Invalid session token")
```
And stamp ordinary session tokens with `purpose="session"`. Alternatively sign challenge tokens with a separate key/audience. Add a regression test: challenge token must 401 on `GET /auth/me`.

### P0-2 · Every signer receives every other signer's bearer token — CRITICAL
`RecipientOut` includes `signing_token: str` (`schemas.py:233`). `SigningSessionOut.all_recipients` (`schemas.py:309`) and `EnvelopeDetailOut.recipients` are serialized with it — the signing-session endpoint is **unauthenticated** (token-bearer), so holder of one signing link calls `GET /api/signing/{token}`, harvests all co-signers' tokens, and can open/sign/decline **as every other party**, bypassing sequential routing entirely. Any workspace `member` can also harvest all tokens via `GET /api/envelopes/{id}`.

**Fix:** create `RecipientPublicOut` (name, status, order, signed_at — *no* `signing_token`, *no* `verification_code_hash`) and use it for `all_recipients` and for non-owner envelope views. Owners should receive prebuilt link URLs at most, never raw bearer tokens.

### P0-3 · Fake "Passkey / Biometric" signing stamps legal documents — CRITICAL (legal/brand)
`handleBiometricSign` (`SigningStudioPage.tsx:351-395`) does `setTimeout(650)` then **draws** "WEBAUTHN / BIOMETRIC PASSKEY CERTIFIED … FIDO2-L2 HW-ASSERTION … SHA-256 ENCLAVE LOCKED" onto a canvas and treats it as the signer's signature. No `navigator.credentials` call exists anywhere. A signature block falsely attesting a hardware-backed WebAuthn assertion on a legally-significant document is a misrepresentation risk (and under EU law can mislead about the assurance level of an AES/SES signature). **Remove the tab or implement real WebAuthn** (`navigator.credentials.create` with `platform` authenticator), and never print certification claims the platform cannot substantiate.

### P0-4 · 2FA enrollment modal can never succeed — and ships a hardcoded test secret
`SettingsPage.tsx:3846-3923`: the modal renders a **mock QR icon** and the **hardcoded demo secret `"JBSWY3DPEHPK3PXP"`** (lines 3874/3879); the code input binds to `totpInputCode` while confirm submits `totpCode` (always `""`); it also optimistically sets `twoFactorConfigured(true)` *before* the API call. The real enrolment payload (`totpEnrol.secret/qr_base64`, fetched at 704-716) is never rendered. Combined with P0-1, 2FA is broken end-to-end: nobody can enroll, and even a valid enrollment doesn't gate sessions. Fix the bindings, render the real QR/secret, delete the demo secret, remove optimistic state.

### P0-5 · Arbitrary file read via SPA fallback path traversal — CRITICAL
`serve_spa` (`main.py:148`): `candidate = os.path.join(frontend_dist, full_path)` with no containment. `os.path.join` **discards the base when the second argument is absolute**, so `GET //etc/passwd` (or `..%2f..%2f` sequences) reads arbitrary files from the API container — including `/app/certs/*.p12` and the environment. Live whenever the unified image or engine compose exposes the API directly.

```python
base = os.path.realpath(frontend_dist)
candidate = os.path.realpath(os.path.join(base, full_path))
if not candidate.startswith(base + os.sep):
    return {"detail": "Not Found"}
```

### P0-6 · Production signing key is baked into image layers
`COPY backend/certs/ /app/certs/` in both `backend/Dockerfile:22` and the unified `Dockerfile:44`. Every `docker compose build` ships the production P12 (and root CA material) into image layers and build cache on the VPS. Anyone with image/registry/daemon access extracts the document-signing identity.

**Fix:** delete both `COPY backend/certs/` lines; mount certs read-only at runtime (`./certs:/app/certs:ro`); add a `.dockerignore` containing `*.p12`, `*.key`, `certs/`, `.env`, `node_modules`. Note `issue_signing_cert.py` defaults its output to `backend/certs/` — the two combine into a guaranteed leak path.

### P0-7 · Mobile scan-to-sign hand-off broken by default deployment
`ConnectionManager` (`ws.py:38-63`) is an in-process dict, but both production Dockerfiles run `uvicorn --workers 2` — two disjoint connection maps. Desktop and mobile land on different workers ~50% of the time and never see each other's `MOBILE_CONNECTED` / `SIGNATURE_CAPTURED` relay. The flagship QR hand-off feature silently fails intermittently today (and the frontend side compounds it — see P1-10 stale closure).

**Fix (pick one):** run **1 worker** with async concurrency now (simplest correct fix); or fan-out via Postgres `LISTEN/NOTIFY` / Redis pub/sub; or sticky sessions + documented single-worker constraint. Pre-requisite for cloud mode: pub/sub, no exceptions.

### P0-8 · Concurrent final signers can permanently stall an envelope
`submit_signatures` takes `with_for_update()` on the envelope row (`signing.py:396-398`) **after** recipients/fields were already loaded — the second request proceeds on stale in-memory status (`expire_on_commit=False`), both signers see `all_signed == False`, both set status `"delivered"` → the envelope is never sealed, never e-mailed, stuck forever. There is also no enforcement of `required` fields.

**Fix:** after acquiring the lock, re-read with `populate_existing=True`; evaluate completion from the fresh snapshot; wrap the whole completion pipeline in the same transaction.

### P0-9 · CI never runs on main — and doesn't cover the frontend or images
`.github/workflows/ci.yml:5` contains `branches: ain]` (mangled YAML — should be `branches: [main]`), so the push trigger matches no branch. There is also no frontend build job, no docker build, no dependency scanning. Every deploy today is untested code reaching the VPS via `deploy_to_vps.py`.

**Fix:** restore `branches: [main]`; add jobs: `pytest` (as-is) → `audit_clean_room.py` → `npm ci && npm run build` → build both images → run `verify_signing.py` inside the built API image → `trivy`/`pip-audit`. Make it blocking; require it green before deploy.

### P0-10 · Signers can write into other signers' fields
`submit_signatures` looks up fields by id only (`signing.py:404-407`) — no `f.recipient_id == recipient.id` check — so signer A can plant text, dates, or a base64 signature image into signer B's fields, which are then flattened into the sealed PDF attributed to B. Also unbounded `signature_data_url` (no size cap → DB/memory DoS).

**Fix:** `if f is None or (f.recipient_id and f.recipient_id != recipient.id): continue` (or 403); cap data URLs (e.g. 512 KB); enforce `required` fields before completion.

### P0-11 · Backup chain is unproven end-to-end
`deploy/backup.sh:27-31` hardcodes volume name `docurama_docurama_storage` — Docker silently auto-creates missing named volumes, so a misnamed project **tars an empty directory and exits 0**. Archives are unencrypted plaintext SQL + signed PDFs, stored on the same VPS, **excluding the P12/root CA** (a new VPS means historical seals are unverifiable). `GO_LIVE.md:235` itself admits storage "holds the only copy of every signed document", and the Phase-0 plan's required daily cron + one restore drill were never implemented.

**Fix:** resolve the real volume via `docker volume ls` and fail if absent; verify `tar -tzf | wc -l` against a floor; encrypt (age/GPG) and rsync offsite; add the certs to the backup set; commit a systemd timer; run and document one restore drill using `deploy/restore.sh` (which is correct — the `GO_LIVE.md:239-245` manual rollback is wrong and should point to it, see P1-18).

### P0-12 · Deploy tooling commits production infrastructure details
`deploy/deploy_to_vps.py:11-13,38` and `scripts/seed_admin.py:22-26,43,52-53` hardcode VPS IP `212.47.79.52`, `root` SSH, and `-o StrictHostKeyChecking=no` (MITM-able admin path; also printed in `GO_LIVE.md:129,242`). Parameterize host/user/key via env with **no defaults**, use `accept-new`, deploy as an unprivileged docker-group user, and rotate the exposed IP.

---

## 3. P1 — High Priority (fix within the first post-launch weeks)

### Security & trust

**P1-1 · No session revocation, 7-day JWTs.** `security.py:50-66` stateless HS256, no `jti`/version claim; `config.py:53` `ACCESS_TOKEN_EXPIRE_MINUTES = 60*24*7`; logout (`auth.py:818-822`) and password change (`auth.py:481-491`) invalidate nothing. A stolen cookie survives a week and a password rotation. Add a per-user `token_version` column checked in `get_current_user`; bump on password change / TOTP disable; shorten TTL + refresh.

**P1-2 · Domain verification: token not required + TLS disabled + redirects followed.** `domain_verifier.py:139` accepts a page containing merely the substring `"docurama-verification"`; `:107,132` use `verify=False, follow_redirects=True` (MITM-able; redirect-based SSRF into internal ranges with status reflected). Verification is permanent — never re-checked. Fix: require the exact token, `verify=True`, `follow_redirects=False`, block private IPs (mirror `validate_webhook_url`), add periodic re-verification.

**P1-3 · Public verify portal leaks PII.** `verify.py:106-120` returns the full audit trail (actor emails, IPs, user agents — `schemas.py:277-282`) to unauthenticated callers, matches on envelope UUID as lookup key, and `verify_by_code` has **no rate limit** while each call runs a pyHanko parse (CPU/network amplifier). Redact the public model (event + name + description only), rate-limit, drop the UUID fallback.

**P1-4 · Settings API leaks third-party credentials & member escalation.** `GET /settings/sms` returns `row.data` verbatim (`settings_api.py:50-72`) — including Telegram bot tokens and Twilio auth tokens — to any workspace member; `PUT /settings/smtp/account` (`settings_api.py:325-351`) has **no owner/admin role check**, so a member can redirect all outbound mail (containing signing URLs) to their own relay. Redact channel secrets (mirror `smtp_config.redact`); require `owner/admin` on SMTP/channel writes.

**P1-5 · `verify=False`-free webhook module still allows cleartext + rebinding window.** `webhook_dispatcher.py:62` permits `http://`; DNS is re-resolved at connect time after validation (:111-119) — TOCTOU. Require https, pin the validated IP via custom transport, truncate error text stored in delivery rows.

**P1-6 · Rate limiting is per-worker, per-IP, in-memory + `FORWARDED_ALLOW_IPS=*`.** `rate_limit.py:15` (slowapi in-memory): limits multiply per worker and reset on deploy; behind nginx all clients share one bucket while a directly-exposed port bypasses them. `.env.example:93` + `docker-compose.yml:36` trust `X-Forwarded-For` from anyone → spoofed IPs land in **audit events and certificates**. Default to the docker bridge range, never `*`; move to a shared store (Redis) for cloud mode; add account lockout/backoff on `/auth/login`.

**P1-7 · Cloud registration is an open abuse surface.** Cloud mode forces open registration (`config.py:111-117`): 5/min in-memory limit, instant `role="admin"` workspace, 7-day Plus trial, **no email verification**, no captcha → trivial trial-farming and storage-quota abuse. Add verified-email gating before envelopes can be sent + trial hard caps + device/IP heuristics.

**P1-8 · Bulk send & public template start bypass quotas.** `POST /envelopes/bulk` (`envelopes.py:396-484`): no `check_envelope_quota` (single create has one at :79), **no invitation emails are ever sent**, `token_expires_at` never set → bulk links never expire. `POST /templates/public/{slug}/start` (`templates.py:162-242`): unauthenticated, no rate limit, no quota check, mints tokens and copies PDFs per call — a scripted attacker farms the owner's quota/disk. Enforce quota + expiry in both; rate-limit the public start; unify the three divergent token-minting code paths (`generate_secure_token(32)` vs `dcr_sig_<uuid4>`).

**P1-9 · Envelope state machine gaps.** `decline` (`signing.py:706-731`) and `delegate` (:740-840) don't check `envelope.status` — a signer can flip a **completed, sealed** envelope to `declined` retroactively, or mint a non-expiring delegated token on it. Guard terminal states; set expiry on every minted token.

### Reliability & performance

**P1-10 · WebSocket client: leak + stale closure + no reconnect.** `SigningStudioPage.tsx:203-225`: cleanup `return () => ws.close()` is discarded (socket never closed on unmount/token change); `ws.onmessage` closes over the *initial* `activeModalField` (always `null`) so **the phone-to-field signature hand-off never fills the open field even when the relay works**; no `onclose`/retry. Fix with a `useRef` for modal state + reconnect with backoff + AbortController-style teardown.

**P1-11 · Synchronous SMTP blocks the event loop (systemic).** `mailer.send_email` is plain `smtplib`, called **directly** from `envelopes.py:223,314`, `signing.py:664,687`, `reminder_sweeper.py:115`, `email_channel.py:38` — one slow SMTP server stalls the whole worker (all tenants) for the timeout × recipients. (`auth.py:741`, `companies.py:506` already use `asyncio.to_thread` correctly.) Centralize one `send_email_async` wrapper and route everything through it; commit per-envelope in the sweeper.

**P1-12 · PyMuPDF/reportlab run inline on async handlers.** `overlay_fields_on_pdf` (`signing.py:491`), certificate generation (`signing.py:557-608`), `get_pdf_pages_info`/`render_pdf_page_png` (`signing.py:194,227` — the latter with **unbounded `?dpi=`**), `FieldDetector.detect_fields` (`templates.py:134`) all block the loop; large PDFs freeze every other request on the worker. `await asyncio.to_thread(...)` for each; clamp `dpi` 72–300 as `documents.py:127` already does.

**P1-13 · TSA request has no timeout, and the seal path does network I/O under a row lock.** `crypto_engine.py:286` `HTTPTimeStamper(tsa_url)` — pyHanko's HTTP timestamper doesn't time out by default; a hanging TSA holds the envelope row lock (P0-8 fix) and the signer's request indefinitely. Configure a client timeout; cap OCSP/CRL fetch retries; add a rate limit to public `verify_by_code` which also triggers network fetches.

**P1-14 · Unbounded uploads on public endpoints.** `verify.py:130-131` copies uploads to temp with no size cap (disk-exhaustion DoS) and `scalar_one_or_none()` on `sha256_original` 500s (`MultipleResultsFound`) for bulk-send documents that share a digest. `stamps.py:71` reads whole file into memory. Cap bytes, stream, use `.first()`.

**P1-15 · Migration safety across replicas.** `entrypoint.sh:5-9` runs `migrate.py` on every start with **no advisory lock** — 2+ replicas race Alembic (and the adoption path can stamp twice). Wrap `migrate.py main()` in `pg_advisory_lock` (same pattern as `reminder_sweeper.py:32-37`) or run migrations as a one-shot compose service. Also make the adoption path fail fast (exit non-zero) on missing NOT-NULL baseline columns instead of stamping a broken schema (`migrate.py:165-174`).

**P1-16 · Horizontal scaling blocked by compose/nginx/storage.** `container_name` on all services (`docker-compose.yml:4,28,49`) breaks `--scale`; `nginx.conf:14` caches one upstream IP; `storage_layout.py` stores absolute local paths with no S3/object-store abstraction. Cloud mode is effectively single-host. Drop `container_name`s, use a resolver-based upstream, introduce a storage interface (`accounts/<id>/` keyed) before cloud beta.

**P1-17 · Containers run as root with no hardening.** No `USER` in any Dockerfile; no `cap_drop`/`no-new-privileges`/`read_only`/resource limits in either compose file; `docker-compose.engine.yml:21` publishes raw uvicorn on `0.0.0.0:3002` (plain HTTP, no TLS). Add non-root users, hardening options, resource limits, bind engine port to `127.0.0.1`.

**P1-18 · Documented rollback is broken.** `GO_LIVE.md:239-245` pipes a dump into psql without dropping the schema and without `ON_ERROR_STOP` → fails immediately on a populated DB; `deploy/restore.sh:24-25` does it correctly. Point the runbook at `restore.sh`, add `rollback.sh` redeploys `$PREVIOUS_TAG` (upgrade.sh already captures it), and fix `upgrade.sh:18`'s `|| ` double-run fallback and `deploy_to_vps.py:196`'s `rm -rf alembic/versions/*` before extract.

**P1-19 · Healthcheck lies.** `/healthz` always reports `healthy` even when signing is unavailable (no/wrong/expired P12); compose, `restore.sh:49` and `upgrade.sh:22` all gate on it. Add `/readyz` returning 503 when `signing_ready` is false; point gates at it.

**P1-20 · Observability ≈ 0.** Only one `logging.getLogger` in the backend (`domain_verifier.py:8`); everything else `print()`; no request IDs, no tenant IDs in logs, no Sentry, no `/metrics`, no log rotation (unbounded json-file). Add structured JSON logging middleware (request-id + account-id — tenant host already captured in `tenant_middleware.py:16`), Sentry DSN knob, `prometheus-fastapi-instrumentator`, compose `logging.max-size`.
### Frontend & UX (P1)

**P1-21 · Hand-rolled routing with no history integration.** `App.tsx:24` reads `window.location.pathname` once per render; no `popstate`, no react-router; back button doesn't undo tab changes; `/templates`, `/submissions`, `/builder` deep links are unhandled while `TemplatesPage.tsx:184` and `SubmissionsPage.tsx:198` do full-page `window.location.pathname=` reloads. Adopt react-router (or add popstate + pushState wiring).

**P1-22 · No ErrorBoundary anywhere.** `main.tsx:6-10` renders `<App/>` bare — any render crash whitescreens the app including the public signing and verify pages (trust-facing). Wrap routes in an ErrorBoundary with retry + support link.

**P1-23 · 401 handling is ad-hoc.** No global 401 interceptor; `App.checkSession` treats *any* failure (500, network down) as "logged out"; mid-session cookie expiry surfaces as random per-page errors with no re-auth path. Add response interception on 401 → graceful sign-in redirect (careful: no loop), and distinct network-vs-auth error states.

**P1-24 · Invalid signing link renders an empty studio.** `loadSessionAndPages` catch only `console.error`s (`SigningStudioPage.tsx:154-158`); there is no `!session` branch — expired/invalid `/s/:token` shows a broken shell. Add a proper "link expired/invalid — contact the sender" state.

**P1-25 · Fake demo templates masquerade as user data.** `TemplatesPage.tsx:102-153`: empty accounts render 4 hardcoded "production" templates with fake `public_slug`s (Share copies links that 404) and a "Use Template" that loads nothing (`App.tsx:262-266` ignores the selection). This kills trust in a signing product. Replace with honest empty states + CTA.

**P1-26 · Billing is a `mailto:` — blocking for cloud launch.** `PricingModal.tsx:46,57` opens `mailto:sales@docurama.rvrad.com`; `onSelectPlan` is never wired; backend `PATCH /quotas/plan` is platform-admin-only (`quotas.py:43-57`). Cloud SaaS needs Stripe (or similar) checkout + webhook-driven plan changes (see §12).

**P1-27 · API docs teach the wrong auth header.** `ApiDocsPage.tsx:56-58` generates cURL/Python with `X-Auth-Token`; the backend accepts `X-Api-Key` (`auth.py:199`) — copy-paste examples 401. (The Settings→API tab uses the correct header.)

**P1-28 · Twilio SMS can never work from the UI.** `SettingsPage.tsx:3256-3285` collects Auth Token but the save payload **omits `auth_token`** (backend `sms_channel.py:66-77` then rejects with "incomplete"); `loadNotificationSettings` never loads `enabled`/`provider`, so the toggle resets visually. Send the token write-only; load state on mount.

**P1-29 · Webhooks have a full client and no UI.** `api.ts:1002-1032` implements CRUD/test/deliveries; no page renders it — while the Business plan advertises webhook dispatch. Build the Webhooks card (list, deliveries log with status, replay, secret shown once).

**P1-30 · Header is unusable on mobile.** Nav links `hidden md:flex` (`Header.tsx:227`) — no path to Templates/Submissions/Verify on phones; both dropdowns close on `onMouseLeave` only (157, 279) — no click-outside, no Escape, no `aria-expanded`, unusable on touch. Add a mobile menu + click/keyboard-friendly dropdowns.

---

## 4. P2 — Medium Priority

### Backend correctness & API design

- **P2-1 · Email case-normalization inconsistency** — register stores verbatim (`auth.py:345`), login matches case-sensitively (`:388`), reset and invite lowercase (`:714`, `companies.py:410`) → a user registered as `John@Example.com` cannot reset or log in with lowercase input. Normalize once (schema validator).
- **P2-2 · CSV formula injection in export** — `envelopes.py:362-394` writes names/labels/values raw; cells starting `=+-@` execute in Excel. Prefix with `'` or sanitize.
- **P2-3 · Mock success in production for SMS/Telegram channels** — `sms_channel.py:56-64`, `telegram_channel.py:53-61` return `success=True, message_id="mock_sms_delivered"` when unconfigured *regardless of environment* — the audit trail then records a send that never happened. Fail closed outside tests.
- **P2-4 · Webhook HMAC lacks timestamp in signature** — `dispatcher.py:96-102` signs only `payload_bytes`; the `X-Docurama-Timestamp` header is unsigned → replay/reorder. Sign `payload + b"." + ts`. Also `asyncio.create_task` without a saved reference (GC-able, lost on deploy) and no durable retry queue (`:174-176`) — keep a task set + retry sweep for failed deliveries.
- **P2-5 · TOTP replay** — `totp.py:59-89` accepts ±1 step but never stores the consumed timestep → code replay within ~90 s. Persist `last_totp_step`.
- **P2-6 · OTP resend bombing** — `manager.py:90-102` only a 30 s cooldown, no per-recipient daily cap; Telegram "obfuscation" returns the raw chat-id/phone (`telegram_channel.py:42`). Cap sends; actually obfuscate.
- **P2-7 · Webhook secret hygiene** — default is a UUID (`models.py:297`), returned in plaintext on every list call (`schemas.py:515`). Use `secrets.token_urlsafe(32)`, display once.
- **P2-8 · CSRF rests solely on SameSite=Lax** — no tokens/custom-header requirement for cookie mutations; any future state-changing GET becomes CSRF-able. Add double-submit token or custom-header check for mutations.
- **P2-9 · Registration email enumeration** — `auth.py:318-321` answers "already exists"; reset flow leaks via synchronous SMTP timing (`:741-743`). Generic errors + background send.
- **P2-10 · Foreign references accepted** — `templates.py:82` and `folders.py:41-46` don't validate that `folder_id`/`parent_id` belong to the caller's account.
- **P2-11 · Missing pagination** — `list_envelopes`/`list_templates` return everything (`envelopes.py:31-64`, `templates.py:31-43`); unbounded for a cloud tenant.
- **P2-12 · N+1 patterns** — `list_webhooks` loads *every* delivery row to `len()` it (`webhooks.py:24-31`); `build_user_out` does 2 queries per membership (`auth.py:66-105`) duplicating `format_company_out`. Use counts; extract one eager-loaded helper.
- **P2-13 · Missing indexes (hot paths)** — `envelopes.account_id` (worst: every tenant listing), composite `(account_id, status)`; `recipients.envelope_id`, `fields.envelope_id`, `audit_events.envelope_id`, `signatures.envelope_id/recipient_id`, `webhook_deliveries.webhook_id`, `envelopes.sha256_original/sha256_signed` (public verify path), `templates.account_id`. Confirmed absent in `0001_baseline.py`. Ship an index migration.
- **P2-14 · FK hygiene** — no `ondelete` anywhere; `delete_company` loops row-by-row (`companies.py:595-691`). Adopt `CASCADE` for children / `SET NULL` for account refs + `passive_deletes=True`.
- **P2-15 · Non-atomic artifact writes** — all PDF writes go direct-to-final-path (`pdf_service.py:75,150,339`; `copy2` fallbacks `signing.py:609`, `crypto_engine.py:241`); a crash leaves truncated files the DB already references. Write to `*.tmp-<uuid>` then `os.replace()`.
- **P2-16 · Orphaned storage** — template/company/unfinished-envelope deletion never removes referenced PDFs (`templates.py:257-269` etc.); `documents.py:46` runs a full storage-tree purge on **every** preview upload. Add a periodic cleanup task; move purge out of the request path.
- **P2-17 · Upload validation drift** — `create_envelope` accepts any file type with no cap and saves **before** validating recipients (`envelopes.py:99-123`, orphaning uploads); `create_template` has no JSON error handling (`templates.py:74-76` → 500). Extract one shared `save_pdf_upload()` (documents.py/auto-detect already do it right).
- **P2-18 · `get_db` commits after the response is serialized** (`database.py:35-44`) — a failed commit after a 200. Commit-in-handler everywhere; teardown rollback-only.
- **P2-19 · No global exception handler** — unhandled errors → plain 500 with no correlation id; `crypto_engine.py:255-258` leaks filesystem paths into seal details. Add a handler (log + request-id), scrub user-visible detail.
- **P2-20 · Model drift** — `Envelope.verification_code` model default vs `0001_baseline` nullable; `Account.plan` model default `"plus"` vs migration `server_default="free"` (silent plan confusion); `User.role` defaults `"admin"` (least privilege should be `member`); JSON columns not `JSONB` (no GIN).

### Security (medium)

- **P2-21 · CSP/security headers absent** — no CSP/HSTS/X-Frame-Options/X-Content-Type-Options in `nginx.conf` or `main.py`; signing pages can be iframed (clickjacking). Add headers; CSP for the canvas app.
- **P2-22 · Stamp/slug abuse** — `public_slug` user-chosen with bare unique constraint (`templates.py:52,78`) → slug squatting + 500 on collision; stamp upload unbounded (`stamps.py:71`).
- **P2-23 · Health/docs recon** — `/healthz` publicly reports cert subject/expiry; `/api/docs` + `openapi.json` public. Gate behind admin in production (configurable).
- **P2-24 · `python-jose>=3.3.0` floor** — known-CVE era versions pass the pin (`requirements.txt:10`); migrate to `pyjwt` or raise the floor.
- **P2-25 · Print-based logging ships PII** — emails in `auth.py:746`, `companies.py:515`; exception text in `crypto_engine.py:57`. Redact; adopt one logging framework.

### DevOps (medium)

- **P2-26 · `.env.example` vs `config.py` drift** — missing `DOCURAMA_SIGNING_TOKEN_EXPIRE_DAYS`, `DOCURAMA_CNAME_TARGET`, `DOCURAMA_SIGNING_CONTACT_EMAIL`, `DOCURAMA_SYSTEM_ACTOR_EMAIL`; `ALLOWED_ORIGINS` hardcoded with stale domains (`config.py:36-49`) and not env-parsable.
- **P2-27 · `docker-compose.engine.yml` default DB password** `docurama_secure_db_pass_2026` (:15,33) — blacklist the string in the production boot guard (`config.py:120-153`).
- **P2-28 · DB container receives the entire `.env`** (`docker-compose.yml:6-7`) including `DOCURAMA_SECRET_KEY` — pass only `POSTGRES_*` vars.
- **P2-29 · Build hygiene** — no `.dockerignore` anywhere (context ships `.env`, `node_modules`, certs); `npm install` instead of `npm ci` despite committed lockfile; `requirements.txt` all `>=` bounds (non-reproducible with `--no-cache` deploys); test deps + gcc ship in the runtime image; base images tag-pinned not digest-pinned.
- **P2-30 · nginx proxy gaps** — no `proxy_read_timeout` on `/api/` (default 60 s vs PAdES+TSA seal time on large PDFs → 504 mid-signing); no cache headers for hashed `/assets/`; unified image has **no** body-size cap at all.
- **P2-31 · Deploy is full-downtime** — `compose down` → `build --no-cache` → `up` (`deploy_to_vps.py:194-215`); build first then `up -d`; prune old images (disk-fill on VPS).
- **P2-32 · Operator docs wrong** — `certs/README.md:6` documents `CERT_PASSWORD` (real var: `DOCURAMA_P12_PASSWORD` → operators ship the dev passphrase and hit the production guard); `reconcile_seal_status.py` documented at `/app/` but installed at `/app/scripts/`; README quick start claims backend at `:8000` and `/docs` (compose publishes neither; Swagger is `/api/docs`).
- **P2-33 · `seed_admin.py` false success** — prints "Password updated" even when the UPDATE matched zero rows (`:83-91`); check `UPDATE ... RETURNING`.

### Frontend & UX (medium)

- **P2-34 · God components** — `SettingsPage.tsx` is 4,228 lines with ~80 hoisted `useState` and **11 API requests on every mount** regardless of tab (339-351); `SigningStudioPage.tsx` 1,829 lines. Split per-tab, lazy-load.
- **P2-35 · UI defaults contradict backend** — `enforceSigningOrder=false`/`prefillSignatures=true` in UI (`SettingsPage.tsx:298,301`) vs backend `True`/`False` (`account_settings.py:36,44`); on GET failure the UI silently shows the opposite of real behavior.
- **P2-36 · Side effects during render** — `loadDomainSetup(dom.id)` invoked in the render body (`SettingsPage.tsx:1571-1573`).
- **P2-37 · Error toasts that lie** — Notifications/SMS failures call `triggerSave()` (green success) instead of red error (`SettingsPage.tsx:1051-1067`); `alert()`/`confirm()` scattered (Header, Templates, Submissions, SigningStudio) alongside the real toast system.
- **P2-38 · Destructive non-atomic API-key rotation** — `handleRotateApiKey` revokes **all** keys serially then mints one (`SettingsPage.tsx:1078-1098`); mid-loop failure leaves the account keyless. No per-key management UI despite backend supporting named keys with scopes/expiry.
- **P2-39 · Builder is desktop-only and click-only** — fields placed by page click; placed fields render drag affordances but **have no drag handlers** (`BuilderPage.tsx:746-756`); no undo, no autosave (tab switch unmounts and loses work); all page PNGs mounted at once (no virtualization); `w-64` rail non-responsive; zoom `hidden lg:flex`. Same pattern in SigningStudio: fixed 800 px width, thumbnail rail always shown, **Request Correction & Audit Info hidden on mobile** (`SigningStudioPage.tsx:803-816`) — a compliance-relevant action lost on phones.
- **P2-40 · Handwriting fonts never load** — `HANDWRITING_FONTS` (Dancing Script/Caveat/Great Vibes, `SigningStudioPage.tsx:50-55`) vs `index.html` loading only Inter + Geist Mono → typed signatures render differently per device than the preview. Three competing font stories (Plus Jakarta Sans theme file never referenced; "Notion Sans" in tailwind config never loaded).
- **P2-41 · Accessibility near-zero** — 1 `aria-label` in the whole app; no focus traps/Escape-close/restore in any modal; `.toggle` sets `outline:none !important` with no `:focus-visible` replacement (`styles/index.css:397-411`); hover-only dropdowns; canvas signing has no keyboard/AT alternative; pervasive 8–10 px text.
- **P2-42 · Tooling absent** — no eslint/prettier/vitest/playwright/husky; `tsconfig` `strict:false`, `noUnusedLocals:false` → `user: any` pervades; unused deps (`clsx`, `tailwind-merge`); 539 kB single chunk (no `manualChunks`/route splitting).
- **P2-43 · Hardcoded demo strings ship to prod** — company default `'Docurama Technologies Inc.'` (`SettingsPage.tsx:291`), initials `'EA'`, BCC `audit@docurama.com`, landing page claims "Unlimited Envelopes" contradicting the 30/250 pricing caps.
- **P2-44 · Void reason hardcoded** — `SubmissionsPage.tsx:81` always sends `'Voided by account owner'`.
- **P2-45 · Test-suite portability + coverage gaps** — 2 tests fail wherever `/opt/docurama` isn't writable (default `STORAGE_DIR` not overridden by conftest). **Untested critical paths** (verified by grepping all client calls): the complete signing flow end-to-end (no test ever completes a signature), concurrent-submit race, decline-after-completion, public verify endpoints, sweeper end-to-end, webhook delivery/retries, WebSocket, void/download/certificate/export/remind, `/settings/smtp`, stamps. Also no `res.ok` checks in `createTemplate`, `voidEnvelope`, `verifyByCode/Upload` (`api.ts:705-711,668-676,840-852`) → errors parsed as success; `verifyByCode` 404 renders "No Digital Signature Found" instead of "code not found".

---

## 5. P3 — Low Priority / Polish

- `GET /api/envelopes/{id}/remind` unthrottled, ignores reminder budget (`envelopes.py:280-337`); `list_domains` creates rows and runs live DNS inside a GET (`domains.py:44-73`) — split into POST/ensure-once.
- Status codes: several mutations return 200 with ad-hoc dicts (`void`, `decline`, `delegate`, `request_correction`) — uneven OpenAPI contract; `title`/`name` fields unbounded.
- Silent PDF fallbacks: `pdf_service.py:410-412` returns a 1×1 PNG for any error; `ContractAnalyzer` swallows exceptions — log instead of hiding corrupt uploads.
- `TemplateOut.pdf_path` exposes absolute server paths (`schemas.py:412`).
- `tenant_resolver.py:39-41` hardcodes `docurama.rvrad.com`/`docurama.eu` fallback roots — deployment-specific coupling.
- Unified `Dockerfile:59` `EXPOSE 8000 3000` — nothing listens on 3000 there.
- `deploy_to_vps.py` never prunes old images; `compose down … || true` masks state.
- `--password` on argv in operator scripts (ps-visible) — prefer prompt/env.
- Settings subtab history: `pushState('/settings/{tab}')` but no popstate → Back exits the app.
- Signature modal not cleared between fields — reopening retains the previous drawing (`SigningStudioPage.tsx`).
- Duplicated Create-Company modal (`Header.tsx:352-426` vs `SettingsPage.tsx:4110-4184`), already diverging.
- Dead code: `notAvailable()` helper never called; `ACXXX…` Twilio placeholder; unused `clsx`/`tailwind-merge`.
- PWA/meta gaps: `apple-touch-icon.png` exists but unlinked; no manifest, no `theme-color`.
- Migration notes: `0009/0010` leave permanent `server_default` values (align with models); `0007` downgrade doesn't restore deduped rows (document).
- README image name depends on checkout directory being literally `docurama`.

---

## 6. Strengths Worth Keeping

For balance — patterns to preserve while fixing the above:

- **Honest seal reporting**: conformance level (B-B/B-T/B-LT/B-LTA) is established by re-reading the sealed file, never claimed a priori (`crypto_engine.py:215-341`) — this is genuinely rare and marketing-worthy.
- **Tenant isolation discipline**: every object lookup filters `account_id` (verified across envelopes/templates/folders/webhooks); dedicated `test_tenant_isolation.py`.
- **Advisory-lock sweeper design** (`pg_try_advisory_lock`) — correct multi-worker pattern, just needs `asyncio.to_thread` around SMTP.
- **Webhook SSRF defenses** (`validate_webhook_url` + re-validation at delivery) — the right idea, needs IP pinning + https-only.
- **Production boot guard** refusing repository-default secrets in production (`config.py:120-153`).
- **Migration philosophy**: pre-Alembic databases are *adopted*, bounded by what the baseline declares; `0002` deliberately never backfills a claim it can't verify.
- **Real HTTP-level test harness** (in-memory SQLite + real app, 391 tests) — extend it, don't replace it.
---

## 7. Settings Functionality Audit — "All settings must work"

The current state **violates the product requirement**: settings persist reliably but roughly half of them have no consumer in the backend. The save/load layer (`PUT/GET /api/settings/{section}` → `account_settings.py`) works; what's missing is *consumers*.

### 7.1 Wiring table (verified against code)

| Setting | Persisted | Backend consumes | Verdict |
|---|---|---|---|
| Company name, timezone | ✅ `updateCompany` | ✅ | **Works** |
| Language (Account tab) | ❌ never sent | — | **Dead UI** |
| Branding accent + logo | ✅ `settings/branding` | ❌ no reader | Persists, no effect |
| Domains (register/verify/enforce/Cloudflare) | ✅ | ✅ | **Works** |
| Force 2FA (`compliance.enforce_two_factor`) | ✅ | ❌ login never checks | Persists, no effect |
| Signing: order enforcement, prefill, decline/delegate toggles, expirable links, auth downloads, multi-signatures, flatten, download filename format, show signature ID, combine audit log, TSA URL | ✅ | ❌ (TSA read from env only, `crypto_engine.py:283`) | Persists, no effect |
| Profile first/last name | ❌ never sent | — | **Dead UI** |
| Contact email | ✅ | ❌ no reader | Persists, no effect |
| Signature/initial stamps | ✅ | ✅ signing prefill | **Works** |
| Password change/reset, TOTP | ✅ | ✅ | Broken UX (P0-4) but endpoint sound |
| Members: invite/remove/restore, roles | ✅ | ✅ | **Works** |
| SMTP account + platform + test send | ✅ | ✅ mailer | **Works** (best card) |
| Notifications: completion alert, BCC, reminder rules, max reminders, reminder subject | ✅ | ❌ sweeper reads env only (`reminder_sweeper.py:66-67`); Max Reminders + Subject never even sent | Persists, no effect |
| SMS (Twilio) enabled/SID/auth token/from/template | ⚠️ token never sent | ✅ `sms_channel.py` | **Broken (P1-28)** |
| API keys create/rotate/revoke | ✅ | ✅ | **Works** (rotation UX P2-38) |
| Certificates register/set-default/delete | ✅ | ⚠️ metadata only | Upload modal fake (P0-6 adjacent, see §11) |
| Webhooks | ❌ **no UI** | ✅ backend ready | **Missing UI (P1-29)** |
| Delete workspace | ✅ | ✅ | **Works** |

### 7.2 Remediation plan (recommended order)

1. **Wire the 6 settings with real compliance impact** (one week of work, highest value):
   - `enforce_two_factor` → check in `get_current_user` (or login) against workspace members; block with 403 + redirect-to-enroll.
   - `signing.enforce_signing_order` + `allow_decline/delegate/resubmit` → gate the corresponding endpoints in `signing.py` (they currently always allow).
   - `signing.tsa_url` → pass into `crypto_engine.seal` as override of env.
   - `signing.expiring_links` → drive `token_expires_at` default on mint.
   - `notifications.reminder_interval_days/repeat_remind_days/max` → sweeper reads account/template values (columns already modeled!) falling back to env.
2. **Fix the dead UI**: send language (i18n groundwork), first/last name (persist to `users`), Max Reminders + Reminder Subject in the notifications payload.
3. **Wire branding** into certificate-of-completion + invitation e-mails (accent color, logo, sender name) — high perceived value, low cost.
4. **Add the missing Webhooks card** (P1-29).
5. **Label honestly in the meantime**: any card not wired gets a small "coming soon" badge rather than silently doing nothing — placebo toggles destroy trust in a signing product.
6. **Split the 4,228-line SettingsPage** per tab (P2-34) *while* wiring, so each consumer lands in a focused component.

---

## 8. Enterprise-Grade Admin Control Panel (design)

Today platform administration exists only as API + CLI (`grant_platform_admin.py`, `PATCH /quotas/plan`, platform settings sections). For cloud mode you need a first-class surface. Recommend a dedicated `/platform` area (separate from workspace Settings), guarded by `role == "platform_admin"`, with:

### 8.1 Tenants & accounts
- Searchable/sortable tenant list: plan, MRR-proxy, envelopes (30d), storage used, last activity, status (active/suspended/trial/expired).
- Tenant detail: members, domains + verification state, quota usage vs plan (`quotas` service already computes usage), recent envelopes, audit highlights.
- Actions: change plan (exists — surface it), suspend/restore (needs new flag + middleware check), impersonate ("sign in as", time-boxed 30-min token, loud banner, audit event **"ADMIN_IMPERSONATION"** — must be in the audit trail it can inspect), GDPR erasure/export (§10).

### 8.2 Platform settings (extend existing platform sections)
- Global SMTP + sender domain (exists), TSA URL + healthcheck button (new), branding defaults, feature flags per plan (wire into `capabilities.py`), trial length, cloud domain, CNAME target.

### 8.3 Trust & compliance console
- Signing certificate inventory: expiry countdown + alerting (GO_LIVE already wishes for a "certificate-expiry diary"), issuer, AATL/EUTL membership state.
- Domain verification queue: re-verification scheduler status, failures.
- Audit log viewer: filter by tenant/actor/event/time; immutable export (signed CSV).
- Data-protection console (§10): DSR queue, retention policy editor, breach-notification checklist.

### 8.4 Operations console
- Health: API replicas, DB, storage volume, queue depth (webhook retries), sweeper last-run/success, TSA reachability, cert days-remaining (already in `/healthz` — surface it).
- Jobs: sweeper runs, webhook redelivery trigger, preview purge, reconcile_seal_status.
- Usage metering: envelopes/documents/storage per tenant over time (feeds billing).

**Build note:** none of this requires new infrastructure — it's aggregation UI over existing models (`accounts`, `account_plans`, `quotas`, `audit_events`, `domain_verifications`, platform settings). Estimate: ~3 focused weeks including impersonation + DSR endpoints. Ship v1 as read-only (inventory + health), then add actions.

---

## 9. Onboarding, Tutorials & First-Run Experience

Current state: a 5-question signup wizard (`OnboardingPage.tsx`, no skip, no "why we ask") then a hard redirect to a Templates page **masked by fake demo templates** (P1-25). No tour, no help center, no sample document.

### 9.1 First-run checklist (recommended core)
A dismissible "Get started" card (persistent state server-side so it survives devices):

1. ✅ Create your workspace *(auto-complete on signup)*
2. ⬜ Upload your first document → CTA straight into Builder
3. ⬜ Place a signature field → coach mark overlay on the page ("click anywhere on the page")
4. ⬜ Send to a test recipient → suggest **your own email** ("sign it yourself in 2 minutes")
5. ⬜ Complete a signature end-to-end
6. ⬜ Verify a document on `/verify` → closes the loop on the trust story

Each step deep-links; checkmarks update from real backend events (envelope created / signature submitted / verification performed) — no fake progress. This turns the audit's biggest test gap (completion flow) into a product feature.

### 9.2 Tutorials & help
- **Interactive coach marks** (driver.js or react-joyride, ~14 kB) on Builder (place → assign → order → send) and SigningStudio (draw → adopt → submit) — both are click-to-place UIs with zero hints today (`BuilderPage.tsx:573` has only a sidebar caption).
- **Sample document**: a bundled 2-page "NDA demo.pdf" + one-click "Try a demo envelope" that creates a real envelope addressed to the user — safe, honest replacement for fake templates.
- **Help center**: a `/help` route with ~10 Markdown articles (create envelope, fields, signing levels SES/AES explained, verify, domains, SMTP, certificates) rendered from a `docs/help/` folder — no CMS needed. Link it in the Header ("Help") and in the signing studio footer (signers are first-time users too).
- **Empty states with CTAs** for folders/domains/certificates/API-keys (currently none).
- **Wire the Language setting** (§7.2) before translating anything — i18n groundwork (`react-i18next`), start with EN/FR/DE given the EU positioning.

### 9.3 Signer-side onboarding
The signing session page is the most-visited page for non-customers: add a 3-step mini-guide (Open → Fill → Confirm), a "What is this document?" banner from envelope metadata, and a help link. Trust UI copy should explain the seal level in plain language (the backend already computes it honestly).

---

## 10. Customer Support Chat — research & recommendation

Researched options (2025-2026 landscape):

| Option | Cost model | GDPR posture | Fit |
|---|---|---|---|
| **Tawk.to** | Free, unlimited agents (paid add-ons) | Data processed by their infra; needs consent banner + DPA | Fastest path; fine for selfhost docs site |
| **Crisp** | Free tier (2 seats) → paid | EU-hosted (France) — good story | Good middle ground for cloud product |
| **Chatwoot** | OSS, self-host (Docker) | Excellent — stays on your VPS, EU | Best long-term for both modes; ~1 small VM |
| Intercom/Zendesk | $$$$ | US processors, SCCs needed | Overkill pre-launch |
| **Build on existing WS infra** | Dev time only | Perfect (data never leaves) | Attractive: you already run a WS server |

**Recommendation — two phases:**
1. **Now (1 day):** Crisp or Tawk.to snippet behind the consent banner, only on marketing + app pages; add a Header "Help" menu (Help center, Contact, Status); route offline messages to `support@`. The audit found support surfaces are currently **zero** (P1/§9) — this alone is a launch requirement.
2. **Post-launch (2–3 days):** **Chatwoot self-hosted** on the EU VPS (docker-compose service alongside, or separate small VM), because: self-host keeps signer/customer PII in your control region, it's free, and it unifies email + chat + WhatsApp (which pairs well with the existing verification-channels work). Add an `SUPPORT_WIDGET_*` env var so selfhost operators can plug their own widget ID — turning support into a *selfhost feature* rather than a hardcode.

Guardrail: never load third-party chat JS on the **signing session** (`/s/:token`) and **verify** pages without explicit consent — these are the trust surfaces; a beacon on them undermines the privacy story.

## 11. Enterprise Admin Panel ↔ Certificates: the "few clicks" free-certificate wizard

User requirement: *"research how a cloud user can set up the signature certificates for free from the certification organisms in a few clicks in the dashboard."*

**Research findings (the honest landscape):**
- **QES (qualified, eIDAS highest tier) is never free** — it requires legally-mandated identity proofing (video/in-person) by a QTSP; "free QES" offers are trials (TrustPro) or subscription-platform plays. Any UI promising "free QES in a few clicks" would be false advertising.
- **Genuinely free options that exist today:**
  - **Actalis** (Aruba Group, Italian CA — an EU qualified CA): **free S/MIME person-validation certificates**, 1-year validity, free renewals; can be used for document-signing at AES level. The only widely-known free certificate from an EU trust-listed CA.
  - **Self-generated organizational certificates** via OpenSSL (the repo already ships `scripts/issue_signing_cert.py` with no-overwrite guards and 600 perms) — free, instant, but trust is private (fine for internal counterparties; recipients see "unknown issuer" warnings elsewhere).
  - **Platform-issued seal** (current default): Docurama signs with its own platform cert — 0 clicks, already works; upgrade path = AATL/EUTL-member document-signing certificate for the platform (paid, ~$100–250/yr from SSL.com/GlobalSign/IdenTrust — cheap because *one* cert covers the platform).
- pyHanko's `pyhanko-certvalidator` supports **both AATL and EUTL** validation — so certificates from EU qualified CAs will validate with proper LTV out of the box.

**Recommended wizard — "Get a signing certificate" (Settings → Certificates):**

| Path | Clicks | Cost | Assurance |
|---|---|---|---|
| **A. Use the platform seal** (default for cloud) | 0 | included | AES — platform-attested |
| **B. Generate organizational certificate** — wizard calls a new `POST /settings/certificates/issue` endpoint that wraps the existing `issue_signing_cert.py` logic server-side (CN = workspace name, key generated + stored with existing Fernet machinery, P12 download offered) | ~3 | free | AES — private trust |
| **C. Bring your own (Actalis free S/MIME)** — step-by-step deep-link guide (actalis portal → verify email → download P12) then the **fixed upload modal** (P0-6 adjacent: current modal has no `onChange` on the file input and never uploads) | ~6 | free | AES — publicly trusted (EUTL/AATL depending on issuer) |
| **D. QES upsell** — "contact/checkout" card for a QTSP partnership (later phase) | — | paid | QES — eIDAS legal equivalent of handwritten |

Wizard UX: 4 cards with an assurance explainer (SES/AES/QES in plain language), progress checklist, then **validation on upload**: password check, key-usage check, chain parse, and a **test-seal of a sample page** with immediate re-verification — proving the cert works before the user relies on it. This reuses the existing cert endpoints (metadata-only today) plus one new issue endpoint; the upload modal bug (P0-6) must be fixed first.
---

## 12. GDPR & EU Compliance Roadmap

Current posture (verified): PII stored includes names, emails, **IP addresses + user agents in audit events**, phone numbers (recipients), signature images, password-reset request IPs. Encryption at rest exists only for recoverable credentials + TOTP secrets (Fernet/HKDF — solid); documents and DB are plaintext on the volume. Hosting is a French OVH VPS (good EU start). No erasure/export endpoints, no retention schedules, no DPA/sub-processor list, no consent tracking.

### 12.1 What the audit found (GDPR-relevant code facts)
- Audit trail exposes IPs/emails to unauthenticated callers via the verify portal (P1-3) — *both* a security and a GDPR leak.
- No right-to-erasure: workspace deletion exists (`companies.py:601-699`) but `users` rows, memberships, and audit-event PII persist with no schedule.
- No data-subject export (Art 15/20) — needed for the cloud product.
- No global exception logging policy; `print()` logs ship emails to stdout (P2-25) — logging is a GDPR surface too.
- Third-party SMS/Telegram channels and (future) chat widgets are sub-processors — none inventoried.

### 12.2 Roadmap (ordered, mapped to articles)

1. **Data map + Records of Processing (Art 30)** — 1 document: subjects (customers, signers, verification-portal visitors), data categories (above inventory), purposes, retention, processors (OVH, SMTP provider, SMS gateway, chat widget, TSA). This is the artifact every DPA request asks for first.
2. **Lawful basis & transparency (Art 6/13)** — contract performance for account data; legitimate interest for audit/security logs; consent for chat widget + optional marketing. Publish privacy policy + cookie banner (needed the moment the chat widget lands, §10).
3. **Retention schedule (Art 5(1)(e))** — document the tension honestly: **completed envelopes have evidentiary value and may be retained** (Art 17(3)(b)/(e) exemptions) — but *hash and truncate*: e.g., audit-event IPs pseudonymized after 12 months; verification-portal query logs 30 days; failed/expired envelopes purged after N months. Implement as a sweeper job (infrastructure exists).
4. **DSR endpoints (Art 15/17/20)** — cloud tier: `GET /privacy/export` (JSON/CSV bundle of the requester's data) and `DELETE /privacy/erase` (anonymize user row: name/email → hashed placeholders, keep envelope evidentiary records, redact IPs/UA in their audit events). Selfhost: same endpoints behind owner auth. ~3–4 days including tests.
5. **Encryption at rest (Art 32)** — enable Postgres/disk-level encryption (LUKS on VPS or managed Postgres with encryption), or app-level: Fernet-wrap PDF bytes at rest using the existing `secrets.py` HKDF machinery. Decide by threat model: for cloud, disk encryption + strict volume access is the pragmatic 80%.
6. **DPA + sub-processors** — publish a DPA (cloud mode) with a sub-processor list (OVH, mail provider, SMS provider, chat, TSA, cert issuers); add a sign-up checkbox for the DPA.
7. **Breach process (Art 33/34)** — 72-hour notification runbook: who detects (Sentry/logs, §P1-20), who decides, template notices. One page, but write it *before* launch.
8. **DPIA (Art 35)** — lightweight one: signature biometrics-adjacent data + audit logs = monitoring-grade processing. The fake-WebAuthn issue (P0-3) must die before any DPIA claims biometric authentication.
9. **eIDAS positioning (marketing-legal alignment)** — state plainly in UI/docs what levels are provided: platform seal + verified-identity invitations = **AES**; QES only via QTSP partnership (§11 path D). Never print "FIDO2 certified" style claims (P0-3).

---

## 13. Selfhost vs Cloud SaaS — Parity Matrix & Cloud Launch Gaps

| Capability | Selfhost today | Cloud today | Gap to close |
|---|---|---|---|
| Core signing/verify | ✅ | ✅ | P0-1/2/7/8/10 fixes benefit both |
| Registration | Closed by default (flag to open) | Open (forced) | P1-7 email verification + trial caps |
| Billing/upgrade | N/A | ❌ `mailto:` | P1-26 Stripe checkout + webhook → `PATCH /quotas/plan` + `Account.plan` |
| Quota enforcement | ✅ single account | ⚠️ bypassable (bulk, public start) | P1-8 |
| Subdomain routing | N/A | ✅ works | Add tenant-aware SPA 404s (phase-1 plan defers this) |
| Custom domains | ✅ | ✅ | P1-2 verification hardening + re-checks |
| Multi-replica | ⚠️ single-host | ⚠️ single-host | P1-15/16 + WS pub/sub (P0-7) |
| Storage | Local volume | Local volume | Storage interface → S3 (EU region) before scale-out |
| TLS | User's proxy | ❌ no wildcard automation | Certbot DNS-01 for `*.cloud-domain` in deploy scripts |
| Admin panel | CLI only | CLI only | §8 |
| DSR/GDPR tooling | Absent | Absent | §12.2 items 3–4 |
| Backups | Broken-ish (P0-11) | Same | Same fix + per-tenant export |
| Support | Nothing | Nothing | §10 |

**Bottom line:** cloud mode is a *thin layer on strong selfhost bones*, but the four hard blockers for cloud are: billing (P1-26), quota bypass (P1-8), multi-worker/multi-replica correctness (P0-7 + P1-15/16), and the admin panel (§8). Everything else is polish on top of parity.

---

## 14. Suggested Execution Order

**Sprint 0 — "Don't launch with these" (≈ 1–1.5 weeks)**
1. P0-1 TOTP purpose check (+ test) · P0-2 `RecipientPublicOut` (+ test) · P0-5 path-traversal guard (+ test)
2. P0-3 remove fake WebAuthn · P0-4 fix 2FA modal
3. P0-6 certs out of images + `.dockerignore` · P0-9 fix CI YAML + add frontend/docker jobs
4. P0-7 single worker (now) · P0-12 rotate the exposed VPS IP, parameterize deploy scripts
5. P0-8 completion race + P0-10 field ownership (+ the missing end-to-end completion test)

**Sprint 1 — "Operate it safely" (≈ 1–2 weeks)**
- P0-11 backup chain + restore drill · P1-18 rollback fix · P1-19 `/readyz` · P1-20 logging/metrics
- P1-11/12/13 to_thread + TSA timeout · P1-14 upload caps · P1-15 migration lock
- P1-1 token versioning · P1-2 domain verification hardening · P1-3 verify-portal redaction · P1-4 settings redaction/roles
- P2-13 index migration · P2-29 build hygiene

**Sprint 2 — "Product completion" (≈ 2–3 weeks)**
- §7.2 wire settings consumers (force-2FA, signing toggles, TSA, reminders) + fix dead UI + Twilio payload (P1-28)
- §9 onboarding checklist + coach marks + honest empty states (remove fake templates P1-25) + help center
- §10 support chat phase 1 · P1-29 webhooks UI · P1-21/22/23 router + ErrorBoundary + 401 handling
- §11 certificate wizard (A/B/C paths) · §12.2 items 1–4 GDPR package

**Sprint 3 — "Cloud launch"**
- §8 admin panel v1 (tenants, health, impersonation, DSR console) · P1-26 billing · P1-7 registration hardening · storage interface + WS pub/sub + migration to replica-ready deploy · wildcard TLS automation

---

*Generated by an independent multi-agent audit: 4 code-review agents (≈250 files read), all critical findings re-verified against source, test suite and production build executed live. File references resolve against `main` @ `35e102e`.*

---

## Appendix — Sprint 0 Execution Status (2026-09-12)

All 12 launch blockers were implemented on the working tree (**not committed**, per instruction). Verification: **401 tests passed / 0 failed** (was 391/2 — the 2 environmental failures were also fixed), frontend `tsc + vite` build green, CI YAML validated, deploy scripts compile.

| Item | Status | Change |
|------|--------|--------|
| P0-1 TOTP bypass | ✅ Fixed | `get_current_user` rejects any token whose `purpose` isn't `session`/absent; all 5 session-token mint sites now stamp `purpose: "session"` (`auth.py`, `companies.py`) |
| P0-2 Signer token leak | ✅ Fixed | New `RecipientPublicOut` (no `signing_token`) used for `all_recipients`; `get_envelope` blanks tokens for non-owner/admin members; frontend hides broken "Sign Link" for blanked tokens |
| P0-3 Fake WebAuthn | ✅ Removed | Passkey tab, mode block, handler, state, and icon removed from `SigningStudioPage.tsx` (−~100 lines of misrepresented "FIDO2-L2" claims) |
| P0-4 2FA modal | ✅ Fixed | Real QR (`totpEnrol.qr_base64`) + real secret rendered; input now binds to `totpCode`; optimistic `setTwoFactorConfigured(true)` removed; recovery codes now displayed post-activation with Done flow; error shown in-modal |
| P0-5 Path traversal | ✅ Fixed | `_resolve_spa_path()` with realpath containment + regression test |
| P0-6 Certs in images | ✅ Fixed | `COPY backend/certs/` removed from both Dockerfiles; runtime read-only mounts added to both compose files; `.dockerignore` created (env, certs, keys, node_modules, .git) |
| P0-7 WS broken by 2 workers | ✅ Fixed | `--workers 1` in both Dockerfiles with explanatory comment (scale via replicas until pub/sub exists) |
| P0-8 Completion race | ✅ Fixed | Envelope collections re-read with `populate_existing=True` under the row lock; recipient rebound from fresh snapshot |
| P0-9 Broken CI | ✅ Fixed | `branches: [main]`; added docker job that builds both images and runs `verify_signing.py` end-to-end inside the API image |
| P0-10 Cross-signer field writes | ✅ Fixed | Field ownership enforced (`recipient_id` match); 2 MB cap on `signature_data_url` (413). *Deferred:* `required`-field enforcement — needs a frontend-contract check first |
| P0-11 Backup chain | ⚠️ Deferred | Sprint 1 (needs operator input: offsite target, encryption keys) |
| P0-12 Infra disclosure | ✅ Fixed | `deploy_to_vps.py` + `seed_admin.py` take `DOCURAMA_VPS_HOST/USER/KEY` (no defaults, fail-fast); `StrictHostKeyChecking=accept-new`; GO_LIVE runbook parameterized. **The exposed IP (212.47.79.52) is still in git history — rotate it.** |

**New tests** (`backend/tests/test_p0_security_regressions.py`, 8 tests): challenge-token rejection, session/legacy-token acceptance, SPA traversal containment, co-signer token hiding, member token blanking, cross-recipient field write block, signature payload cap, and a full envelope-completion flow (upload → sign → complete → honest seal reporting).

**Also fixed:** conftest now defaults `DOCURAMA_STORAGE_DIR` to a temp dir — the suite is portable again (fixes the 2 environment-dependent failures).

**Deferred to Sprint 1** (as planned): P0-11 backup encryption/offsite/drill, plus all P1 items.

---

## Appendix — Sprint 1 Execution Status (2026-09-12)

"Operate it safely" implemented on the working tree (**not committed**, per instruction). Verification: **419 tests passed / 0 failed** (401 before the sprint; 18 new tests), migrations 0011 + 0012 run clean on SQLite and Postgres-dialect branches preserved, all deploy scripts pass `bash -n` / compile, `/readyz` verified live (200 ready with cert; contract 503 without).

| Item | Status | Change |
|------|--------|--------|
| P0-11 Backup chain | ✅ Fixed | `backup.sh`: volume discovered via compose label (hardcoded name removed), DB dump line-floor + storage member-floor verification (empty tars refused), certificates added to the backup set, optional `age` encryption via `DOCURAMA_BACKUP_AGE_RECIPIENTS`, optional offsite `rsync` via `DOCURAMA_BACKUP_RSYNC_TARGET`; systemd `docurama-backup.{service,timer}` committed; restore drill documented in GO_LIVE.md |
| P1-1 Session revocation | ✅ Fixed | `users.token_version` (+ migration 0011); every session JWT carries `ver`; `get_current_user` refuses mismatches (pre-`ver` tokens honoured as 0); bumps on password change, password reset, TOTP disable, and sign-out — a stolen cookie now dies with the credential that minted it |
| P1-2 Domain verification | ✅ Fixed | web_confirmation requires THIS domain's token (bare marker no longer passes); TLS verification ON; redirects refused; hosts resolved over DoH and private/reserved addresses blocked before any fetch (mirrors webhook guard) |
| P1-3 Verify portal PII | ✅ Fixed | New `PublicAuditEventOut` (event, actor name, description, time — no emails/IPs/UAs); envelope UUID no longer a lookup key; `verify_by_code` rate-limited 20/min |
| P1-4 Settings leaks/roles | ✅ Fixed | `GET /settings/sms` returns `*_set` booleans instead of Twilio/Telegram/WhatsApp secrets; blank secrets on save no longer wipe stored ones (write-only semantics); SMS + account SMTP writes require workspace admin/owner |
| P1-11 Blocking SMTP | ✅ Fixed | All 6 remaining `mailer.send_email` call sites (envelopes, signing ×2, reminder sweeper, email OTP, plus auth/companies already done) run via `asyncio.to_thread` |
| P1-12 Blocking PDF ops | ✅ Fixed | `get_pdf_pages_info`, `render_pdf_page_png` (dpi clamped 72–300), `overlay_fields_on_pdf`, certificate generation, certificate append, `FieldDetector.detect_fields` — all off the event loop |
| P1-13 TSA + amplifiers | ✅ Fixed | Explicit `HTTPTimeStamper(timeout=8)`; public verify rate limit + upload cap (also P1-14) |
| P1-14 Unbounded uploads | ✅ Fixed | verify-by-upload streams with a 50 MB ceiling (temp file removed on violation); bulk-shared digests use `first()` + ordering instead of `scalar_one_or_none()` (500 → deterministic result); stamp file upload capped at 2 MB |
| P1-15 Migration races | ✅ Fixed | `migrate.py` takes a Postgres advisory lock (replicas serialise); adoption path fails fast (non-zero) on missing NOT-NULL baseline columns instead of stamping a broken schema |
| P1-18 Broken rollback | ✅ Fixed | New `deploy/rollback.sh` (redeploys tag recorded by `upgrade.sh` in `.previous-tag`); `upgrade.sh` double-run `||` fallback removed, gates on `/readyz`; `deploy_to_vps.py` no longer `rm -rf`s `alembic/versions/` before extract (verifies instead); GO_LIVE rollback rewritten around `restore.sh` + rollback |
| P1-19 Healthcheck lies | ✅ Fixed | `/readyz` returns 503 unless the signing certificate is installed, readable and in validity; Dockerfile HEALTHCHECKs, `restore.sh` and `upgrade.sh` all gate on it |
| P1-20 Observability | ✅ Fixed | New `app/core/observability.py`: JSON log formatter + `RequestLoggingMiddleware` (request-id honoured inbound, echoed as `X-Request-ID`, method/path/status/duration logged, ≥400 warn, ≥500 error with traceback); compose `json-file` rotation (10 MB × 3). *Deferred:* Sentry DSN knob + Prometheus `/metrics` (needs dependency decision) |
| P2-13 Missing indexes | ✅ Fixed | Migration 0012: 13 hot-path indexes (envelopes account/status/sha256, recipients, fields, audit_events, signatures ×2, webhook_deliveries, templates, domain_verifications) |
| P2-29 Build hygiene | ✅ Partial | `npm ci` in both frontend Dockerfiles (lockfile-pinned); `.dockerignore` shipped in Sprint 0. *Deferred:* requirements pinning, digest-pinned base images |

**New tests (18):** `test_token_revocation.py` (6) — password change/TOTP disable/logout orphan earlier tokens, no-session logout 200, stale `ver` refused; `test_domain_verification_hardening.py` (6) — marker-only page rejected, exact token accepted, private address never fetched, redirects not followed, TXT marker strictness ×2; `test_sprint1_security.py` (6) — audit-trail redaction, UUID lookup closed, secrets never returned, blank-save keeps stored secret, member blocked from SMS/SMTP, admin allowed.

**Also fixed:** Alembic migrations 0003/0007 made dialect-portable (Postgres `INTERVAL`/`DELETE..USING`/`ADD CONSTRAINT` → SQLite/MySQL branches), so the suite and local dev boot on SQLite; `migrate.py` log prefix typo (`igrate]`) normalised; demo runtime launcher at `scripts/run_docurama_local.sh` (single worker, SQLite, self-minted dev cert chain).

**Deferred to Sprint 2** (as planned): settings consumers wiring (§7.2), onboarding, support chat, webhooks UI, router/ErrorBoundary/401 handling, certificate wizard, GDPR package.

## 15. Compliance & Trust Foundation — Verified Gap Analysis (2026-09-13)

Methodology: every status below was verified against the working tree on 2026-09-13 by direct
code inspection and live probes — not inferred from plans or documentation. The baseline
analysed is the Sprint 0–2 tree (419 tests green). **Incident note:** between working sessions
the sandbox restored a 2026-09-12 filesystem snapshot, which destroyed the uncommitted
Sprint 3 working-tree provision (billing/storage/pubsub/legal/admin surfaces, migration 0013,
34 tests) and the §15–§18 research write-ups. Sprint 0–2 survived (present in the snapshot).
Re-provisioning from the documented specification is Step A of the Sprint 4 plan below; if an
operator-downloaded copy of the 2026-09-13 working tree exists, restoring it collapses Step A
to minutes. All Sprint 3 facts previously verified are retained in the worklog and are restated
where they affect phases below.

### 15.1 Phase-by-phase status matrix

| # | Phase (brief) | Status | Verified evidence (current tree) | Sprint 4 action |
|---|---------------|--------|----------------------------------|-----------------|
| 1 | Control framework (catalog, owners, evidence links) | Missing | No controls/evidence models or seed anywhere in `app/` | Controls + evidence tables, seeded from real code, admin API |
| 2 | GDPR technical foundation | Partial | Consent: nothing (Sprint 3 consent records lost with rollback). Redaction + suppression: public audit redaction (P1-3) exists. DSAR/rectification/restriction/objection/deletion/export/processing-registry/legal-basis/subprocessors/residency: absent | Full DSAR workflow, consent records, registries (Step B) |
| 3 | Retention policies + enforcement + legal hold | Missing | No retention tables/jobs; only backup retention at operator level (`backup.sh`, Sprint 1) | Retention policy model + sweeper enforcement + legal hold |
| 4 | Export & deletion endpoints (bg jobs, state machine) | Missing | No `/privacy/*` routes; background-job pattern exists (reminder sweeper + advisory lock) | Export/delete as observable background jobs with 5-state lifecycle |
| 5 | E-signature record integrity | Largely implemented | PAdES seal (pyHanko + RFC-3161), sha256 original/signed stored, audit events cover created/sent/opened/signed/completed/declined/voided/delegated/reminder, recipient isolation + field ownership (P0-2/P0-10), token expiry (migration 0003) | Add granular events (signature_started, authentication_completed); verify coverage per event |
| 6 | Tamper-evident audit chain | Missing | `AuditEvent.hash_state` stores the **document** sha only (verified `envelopes.py:203`, `signing.py:674`); no previous-event hash, no chain, no verify endpoint | Hash-chained audit (prev-hash + event hash), chain-verify endpoint, sealed snapshots |
| 7 | Authorization audit (IDOR/escalation) | Strong, residual known | Tenant isolation tested; P0-2/8/10 fixed; purpose-bound tokens; workspace-admin gates (Sprint 1). Residuals documented: decline/delegate state guards, contract-analysis token checks | Re-audit pass + close two residual MEDIUMs |
| 8 | Authentication security | Strong, partial gaps | Argon2, TOTP + real QR + recovery codes (P0-4), rate limits 5–10/min, `token_version` revocation (Sprint 1), HttpOnly cookie, 7-day expiry. Missing: real WebAuthn (fake removed in P0-3, honest removal), refresh-token rotation (JWT-only), suspicious-login detection, CSRF tokens (SameSite=lax reliance) | Phase in: security-event logging first, then suspicious-login heuristics; WebAuthn as follow-on |
| 9 | Encryption (transit/at-rest/secrets) | Partial | TLS via operator automation (Sprint 3 script lost — re-provision); secrets env-only + production guard rejects dev P12 password; backup age-encryption opt-in (Sprint 1). Missing: storage-at-rest encryption layer, KMS | Re-provision TLS script; document at-rest posture honestly; add storage encryption option |
| 10 | Document storage pipeline | Partial | `documents.py` streams with hard cap + magic-byte check; `templates.py` validates by content; SPA traversal fixed (P0-5). **Gap found today: `envelopes.py` upload (the primary path) does no magic-byte/content validation — straight `copyfileobj` (`envelopes.py:100-105`)** | Fix envelope upload validation; re-provision storage backend w/ containment + presigns |
| 11 | Security event logging | Partial | JSON request logs + X-Request-ID (Sprint 1); envelope lifecycle in `audit_events`. **Verified gap: `auth.py` writes zero audit events — logins, failures, MFA changes, password changes, API-key creation are not in the audit trail** | `security_events` recording at all sensitive actions, admin-visible |
| 12 | Incident management | Missing | No incidents model/endpoints (legal intake existed only in lost Sprint 3 tree) | Incidents table + escalation + GDPR breach workflow (72h clock) |
| 13 | Subprocessor registry | Missing | Nothing in code; research base exists in §10-era analysis | Registry model + seeded real providers + public page data |
| 14 | Security policies | Missing (by design) | Spec's own rule: policies only where controls exist — correctly nothing yet | Write policies in Step D mapped 1:1 to implemented controls |
| 15 | Evidence system | Missing | No evidence model | Control→evidence→verifier→timestamp model + collectors |
| 16 | Compliance dashboard | Missing | AdminPage v1 lost with Sprint 3; §8 design exists in this document | Re-provision admin v1, extend with readiness panel (status vocabulary: Implemented/Partial/Missing/Needs Review — never "certified") |
| 17 | Access reviews | Missing | No review tables/endpoints | Periodic review model with approve/revoke/expire + decision log |
| 18 | Backup & DR | Strong (operator level) | `backup.sh` rewrite (Sprint 1): floors, certs, age encryption, rsync opt-in; `/readyz` gating; restore drill documented. Missing: in-app backup health checks; restore-test evidence record | Automated backup verification job + evidence record |
| 19 | Secure development (CI scans) | Partial | `ci.yml` fixed (P0-9): build + signing e2e on main. Missing: dependency/secret/static scans, fail-on-critical | pip-audit + npm audit + gitleaks + bandit gates with severity thresholds |
| 20 | API security (idempotency, pagination, errors) | Partial | Auth + rate limits + request IDs + timeouts (SMTP/TSA); signing has lock-re-read idempotency (P0-8). Missing: uniform error shape, pagination on some lists, idempotency keys for exports/deletion | Standardise error envelope; add idempotency keys to sensitive ops |
| 21 | Webhook security | Partial | Outbound HMAC-SHA256 signing **exists** (`webhook_dispatcher.py` `generate_signature`, `X-Docurama-Signature`). Missing: outbound retry/dedup (fire-and-forget), inbound Stripe verify+dedup (lost with Sprint 3) | Retry queue + event-ID dedup; re-provision signature-verified inbound with dedup |
| 22 | Compliance automation jobs | Partial | Sweeper pattern with advisory lock proven; nothing compliance-specific | Retention, access-review, evidence-collection, stale-key jobs — all observable |
| 23 | Public trust center | Missing | Only `security.txt` (lost with Sprint 3) | `/trust` page with strict status vocabulary, subprocessors, contact |
| 24 | EU/French positioning (factual) | Partial | §12 GDPR roadmap + eIDAS research exist as analysis; no residency metadata, no French i18n (documented P2) | Residency metadata field + factual copy only; no unverified claims |
| 25 | Final repository audit | Ongoing | P0–P1 fixes tested in suite; today's sweep added the envelope-upload finding | Full sweep after re-provisioning, before Sprint 4 exit |

### 15.2 Ranked build order for the compliance core

1. **Audit hash chain (Phase 6)** — highest integrity value and the differentiator for an e-signature product: chain every audit event, expose chain verification, snapshot sealed envelopes. Evidence is the product here.
2. **DSAR + retention engine (Phases 2/3/4)** — export/deletion background jobs with the five-state lifecycle, configurable retention with legal hold, consent records. This is the bulk of GDPR "technical foundation".
3. **Security-event recording (Phase 11)** — auth and administrative actions into an append-only trail, feeding the chain from item 1.
4. **Incidents + subprocessors (Phases 12/13)** — operational tables with escalation and the 72-hour breach clock; registry seeded with the real providers the stack actually uses.
5. **Controls/evidence + dashboards (Phases 1/15/16/17)** — catalog seeded from what is genuinely implemented (the matrix above is the seed data), readiness panel with the four honest statuses, access reviews.
6. **Upload validation + webhook hardening (Phases 10/21)** — the envelope magic-byte fix, outbound retry/dedup, re-provisioned inbound verification.
7. **CI security gates (Phase 19)** — dependency, secret, and static scans, fail on critical.
8. **Trust center + factual positioning (Phases 23/24)** — public page driven by the subprocessor registry and the controls catalog.
9. **Policies (Phase 14)** — written last, each mapped to a control ID that exists in code.

### 15.3 Terminology guardrails (binding for all copy)

The product must say: "GDPR compliance program", "ISO 27001 aligned", "SOC 2 readiness",
"security controls implemented", "compliance evidence available". It must never say
"certified" for any framework absent an actual independent certificate, and the trust center
and dashboard carry the same vocabulary. Readiness values are limited to Implemented /
Partial / Missing / Needs Review.

### 15.4 Sprint 4 execution plan

- **Step A — Re-provision Sprint 3 baseline** (from the retained specification): security-headers middleware, API 404 correctness, security.txt, billing scaffold (inert until operator keys), storage backend (local+S3), Redis-backed pub/sub, domain-activation flow + migration 0013, registration hardening, legal intake, admin console v1 + AdminPage, marketing-email tables, TLS automation script, DESIGN.md, `.env.example` block, 34-test restoration. *Collapses to a restore if the operator provides the 2026-09-13 tree copy.*
- **Step B — Compliance core**: items 1–4 and 6 of §15.2 in that order, each with tests.
- **Step C — Dashboards & trust**: items 5 and 8, frontend + API.
- **Step D — CI gates & policies**: items 7 and 9.
- **Step E — Final validation**: full pytest, typecheck, production build, dependency audit, secret scan, migration validation on both dialects; rerun until green. No certification claims in any artifact.

## Appendix — Sprint 3 Re-provisioning Status (2026-09-13)

The Sprint 3 baseline lost in the snapshot-rollback incident (see §15 preamble) has been
rebuilt from the retained specification and re-verified end-to-end. Working tree only,
**nothing committed**.

### Shipped (rebuilt)

| Item | Status | Change |
|------|--------|--------|
| S-1 Security headers | ✅ Shipped | `app/core/security_headers.py`: CSP (nonce-free, SPA-safe), X-Frame-Options DENY, XCTO nosniff, Referrer-Policy, Permissions-Policy; HSTS only over TLS (direct or X-Forwarded-Proto) |
| S-2 API 404 | ✅ Shipped | Unmatched `/api/*` and `/ws/*` answer real 404s instead of 200-with-error-body |
| security.txt | ✅ Shipped | RFC 9116 `/.well-known/security.txt` registered before the SPA catch-all; contact from `DOCURAMA_SECURITY_CONTACT` or derived from APP_URL |
| Billing scaffold (P1-26) | ✅ Shipped (inert) | `services/billing.py` + `api/billing.py`: honest plan catalog (plus/business/enterprise with `configured_price_id` empty), subscription state, checkout, portal, one-click period-end cancel (click parity), signature-verified webhook as the only plan-state writer. Stripe keys are operator placeholders; endpoints answer honest 503s until then |
| Storage interface | ✅ Shipped | `services/storage_backend.py`: key validation (absolute keys rejected, traversal rejected, null bytes rejected), LocalBackend (atomic tmp+rename, realpath containment, DB-row compatible), S3Backend (private objects, presigns clamped 30–900s, boto3 lazy, injectable client), `get_backend()` fails closed to local |
| WS pub/sub | ✅ Shipped | `core/pubsub.py`: InMemoryPubSub (default) + RedisPubSub (`DOCURAMA_REDIS_URL`), local-first delivery, origin-stamp echo suppression, capped-backoff reconnect, never-raise degradation; `api/ws.py` subscribes per token on connect and unsubscribes on disconnect |
| Domain activation (§18) | ✅ Shipped | Migration 0013 (`join_mode`), `POST /domains/{id}/join-mode` (verified-domain gated, unknown modes 422), registration branch (verified-domain email match → inactive member account, no new workspace), `POST /auth/domain-join/activate` (purpose=domain_join, single-use via token_version, auto_join grants membership / approval queues a request), approval queue (`GET /domains/joins/pending`, `POST /domains/joins/{id}/approve`), login refuses inactive accounts, activation email with EmailSendLog accountability record |
| Registration hardening (P1-7) | ✅ Shipped | Neutral age gate (operator-off-able via `DOCURAMA_AGE_GATE_REQUIRED`, checked after host eligibility), explicit marketing consent with timestamp (GDPR Art. 7), SignUpPage carries both controls (consent never pre-ticked) |
| Legal intake (§15.4 items 5/13) | ✅ Shipped | `api/legal.py`: public 5/hour DMCA + TAKE IT DOWN intake with verbatim statements + reporter IP, SLA labels (5 business days / 48 hours), platform-admin queue + resolution with recorded decision |
| Admin console v1 (§8) | ✅ Shipped (scaffold) | `api/admin.py` (platform-admin gated): tenant inventory (SQL-aggregated counts, name search) + detail, legal queue + resolve; frontend `/admin` route + `AdminPage.tsx` (tenants table, legal queue with SLA badges, joins approval) |
| Frontend activation page | ✅ Shipped | `/activate?token=…` → `ActivationPage.tsx` reporting activated / pending-approval / failed honestly |
| Marketing email scaffold (§17) | ✅ Shipped | `marketing_unsubscribes` + `email_send_logs` tables; users carry `marketing_consent(_at)`; sequence copy + ESP wiring remain operator-managed |
| TLS automation | ✅ Shipped (operator keys) | `deploy/tls_wildcard.sh`: lego DNS-01 wildcard issue/staging/renew with provider-agnostic `DOCURAMA_DNS_PROVIDER`, quiet cron renewal |
| Research tooling | ✅ Shipped | `scripts/run_strix.sh` (STRIX_API_KEY + Docker, operator-managed) |
| DESIGN.md | ✅ Shipped | `frontend/DESIGN.md`: tokens, a11y floor, honest-status and legal-friction rules |
| .env.example | ✅ Updated | Full Sprint 3 operator block (STRIPE_*, DOCURAMA_BILLING_ENABLED, DOCURAMA_REDIS_URL, DOCURAMA_STORAGE_BACKEND + S3 bucket, DOCURAMA_SECURITY_CONTACT, DOCURAMA_AGE_GATE_REQUIRED, DOCURAMA_TLS_DOMAIN) |
| redis dependency | ✅ Pinned | `redis>=5.0,<6` (optional at runtime; lazy import) |

### Migration 0013 (dialect-aware, idempotent)

`users.marketing_consent(_at)`, `domain_verifications.join_mode`, `accounts.current_period_end`
/ `cancel_at_period_end`; new tables `legal_notices`, `marketing_unsubscribes`,
`email_send_logs`, `domain_join_requests`. Column additions check existence first (heals
partial runs) and take the SQLite batch path; applied clean to the live SQLite demo DB.

### Tests (38 new; suite 419 → 457, all green)

`test_sprint3_cloud_launch.py` (31): headers present, no HSTS over plain http, HSTS via
proxy header, API 404, WS 404, security.txt, storage key validation / local roundtrip +
containment / S3 stub roundtrip + presign clamp / backend selection, in-memory pub-sub
delivery + unsubscribe, Redis-down degradation, catalog honesty, checkout 503, subscription
state, webhook refusal unsigned + 503 unconfigured, pure Stripe event mapping, unconfigured
adapter raises, domain-join end-to-end (register → pending → inactive login block → activate
→ single-use replay → successful login), join-token never-a-session, verified-domain gate,
unknown-mode rejection, approval-mode queueing + admin approval, marketing consent recorded /
absent, DMCA + TAKE IT DOWN intake, kind validation, admin-only queue.
`test_registration_gate.py` (+7 net): payloads updated for the age statement, gate blocks,
gate disableable, false confirmation rejected.

### Fixes made during re-provisioning

- `User.is_active` now enforced at login (administratively pending/disabled accounts refused
  even with correct credentials); `get_current_user` already refused them
- slowapi-limited endpoints carry the required `response: Response` parameter (checkout,
  portal, cancel, activation)
- S3 handles that already carry the backend prefix are no longer double-prefixed
- Absolute storage keys are rejected outright instead of silently relocated

### Live verification on :3000 (all passing)

Headers on API responses; `/api/not-a-route` 404; security.txt served; catalog honest
(`billing_enabled:false`, empty price IDs); authenticated checkout 503; admin unauth 401;
DMCA intake 201 with SLA; subscription state honest; SPA rebuilt (AdminPage + ActivationPage
+ SignUpPage consent controls bundled).

### Operator handoff (unchanged — what only you can supply)

| Input | Unlocks |
|---|---|
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + three price IDs + `DOCURAMA_BILLING_ENABLED=true` | Real checkout/portal/cancel; webhook sync |
| `DOCURAMA_REDIS_URL` | Cross-replica WS fan-out (run >1 replica safely) |
| `DOCURAMA_STORAGE_BACKEND=s3` + bucket credentials | Cloud storage without local volume coupling |
| `DOCURAMA_TLS_DOMAIN` + DNS provider token | `deploy/tls_wildcard.sh issue` → wildcard TLS |
| DMCA agent registration + legal/privacy documents | Safe harbor + §15.4 paperwork items |
| `STRIX_API_KEY` (+ Docker) | `scripts/run_strix.sh` agent pentest |
