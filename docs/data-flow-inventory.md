# Data Flow Inventory (GDPR Art. 30 / Art. 28 support)

**Owner:** Platform operator · **Review frequency:** quarterly · **Scope:** every personal-data pathway the code can exercise, and every third party it can reach.

This inventory describes what the **code actually does** - the flows an
out-of-the-box deployment can produce. It is the factual counterpart to the
operator-maintained subprocessor registry (see
`docs/policies/subprocessors.md`): when the operator enables one of the
optional integrations below, the registry must record that processor with
its real data location before traffic flows.

## 1. Primary data stores

| Store | Contents (personal data) | Location | Access path |
|-------|--------------------------|----------|-------------|
| PostgreSQL database | Identity (name, email, password hash - Argon2id), workspace memberships, envelope metadata, recipient email + signing-channel metadata, audit events, billing state (Stripe customer/subscription ids; no card data), settings | Operator-chosen (EU region required for the EU claim) | App only, credentials via environment |
| Document storage (`DOCURAMA_STORAGE_DIR` or S3) | Uploaded PDFs, signed/sealed PDFs, preview renders | Operator-chosen volume or private bucket; AES-256-GCM at rest when `DOCURAMA_STORAGE_ENCRYPTION_KEY` is set | Envelope-scoped paths, account-checked on every read |
| Signing certificates (PKCS#12, root CA) | Signing identity - NOT personal data of end users, but trust-anchor material | Local certs dir, part of encrypted backup set | Signing engine only |

## 2. Processor map (code-level touchpoints)

| Processor | When it receives data | What it receives | Resident EU? | Contract needed |
|-----------|----------------------|------------------|--------------|-----------------|
| **Stripe** | Checkout, subscription lifecycle | Email (checkout), name/billing details entered on Stripe-hosted pages, plan + commitment metadata, account id | Stripe supports EU data processing; residency depends on the Stripe contract/region settings | DPA via Stripe |
| **SMTP provider** (operator-configured) | Every transactional email (activation, reset, invitation, signing, completion, admin alerts) | Recipient email, document title, signing/verification links (contain opaque tokens) | Whichever provider the operator configures - EU claim requires an EU mail provider | DPA with the mail provider |
| **TSA (RFC 3161)** | Sealing, when `DOCURAMA_TSA_URL` is set | A SHA-256 hash of the signature (message imprint) - **no document content, no personal data by design** | Operator's choice; the qualified-TSA decision (EIDAS-02) should select an EU-listed authority | Service terms; no DPA needed when only hashes flow |
| **Redis** (optional, `DOCURAMA_REDIS_URL`) | WebSocket relay fan-out when configured | Signing-session relay payloads (ephemeral) | Operator-chosen instance | Internal/none if self-operated |
| **Edge/reverse proxy** (Caddy/nginx) | All traffic | TLS-terminated requests, IPs in access logs | Operator's infrastructure | n/a |

**What the code deliberately never does:** no third-party analytics, no
advertising or tracking scripts, no external font CDN (fonts are
self-hosted in the bundle), no error-tracking SaaS wired by default, no
customer document content sent to any LLM or external service.

## 3. Flow diagrams (per subject role)

**Account holder:**
`Browser (app origin) → Docurama API → PostgreSQL + document storage`
Signup sends email through the operator's SMTP (email + activation token).
Billing interactions hand the user over to Stripe-hosted checkout; card
data never touches Docurama servers (SAQ-A posture).

**Document recipient (signer):**
`Signing link (email) → app origin /sign → Docurama API`
The recipient authenticates by the channel the sender configured (email
OTP, WhatsApp/Telegram OTP where enabled). Signature image, typed name,
IP and timestamp evidence are written to the envelope's audit record;
the sealed PDF stays in document storage. Nothing is disclosed about the
sender's organisation beyond the document itself.

**Third-party verifier:**
`Verification link or /verify upload → public verify endpoint`
Verification evaluates the cryptographic state of the uploaded/served PDF
only. It returns observed facts (signature present/intact, timestamp,
PAdES level). It exposes no tenant data and requires no account.

## 4. Data subject rights machinery

- **Access/erasure (DSAR):** request workflow implemented
  (`DsarRequest`, admin processing endpoints, background worker);
  export covers identity + envelope metadata; erasure is performed as a
  verifiable, ledger-logged cascade.
- **Retention:** per-workspace retention policies (`RetentionPolicy`,
  `retention.py`) sweep expired envelopes and their documents, recording
  every state change in the hash-chained ledger.
- **Consent:** registration-time consents are recorded
  (`ConsentRecord`), including marketing consent with timestamp.

## 5. Residency claim discipline

The platform code is residency-agnostic: PostgreSQL, storage, SMTP, TSA
and edge are all operator-selected. An "EU-only" claim is TRUE for a
deployment only when every operator-selected component above is actually
EU-resident:

1. PostgreSQL + document storage in an EU region;
2. an EU mail provider (or self-hosted mail in the EU);
3. backups (including the offsite rsync target) inside the EU;
4. a TSA whose policy commits to EU processing (qualified EU-listed
   authority recommended);
5. no optional non-EU SaaS added later (monitoring, error tracking)
   without registering it and re-evaluating the claim.

Anything less must be described as "EU-available with configurable
residency" in marketing material - never as unconditional "EU-only".
