# Day-0 Production Launch Execution Plan: Docurama Cloud & StalFe Enterprise

This execution plan outlines the prioritized sequence of actions required to close the remaining Day-0 operator launch gates and bring **Docurama Cloud** (`docurama.eu` / `app.docurama.eu`) and **StalFe Enterprise** (`docurama.stalfe.com`) into full public production availability.

---

## 1. System Architecture & Live Baseline

The system has achieved clean separation and local/remote git synchronization:
* **StalFe Enterprise (`docurama.stalfe.com`)**:
  * Stack: `/opt/docurama-enterprise` on port `3003`.
  * Database: Historical `docurama` database (`admin@stalfe.com`, historical envelopes preserved).
  * Certificates: StalFe Document Signing Certificate (valid to 2029) and Root CA active.
* **Docurama Cloud SaaS (`docurama.eu` / `app.docurama.eu`)**:
  * Stack: `/opt/docurama-cloud` on port `3002`.
  * Database: Fresh `docurama_cloud` database (clean multi-tenant slate).
  * Cloudflare: Zone active with Full SSL, TLS 1.2+, HTTP/3, Brotli, and vanity redirects (`signup.docurama.eu` -> `app.docurama.eu/sign_up/`).
* **VPS Host Hardening (`212.47.79.52`)**:
  * `DOCURAMA_SECRET_KEY`: Cryptographically rotated on both stacks (48-char random keys).
  * Backups: `/usr/local/bin/backup_all.sh` backing up both DBs, storage volumes, and certs nightly at 03:15 UTC via `docurama-backup.timer` (14-day retention).
  * Git Branches: `quality` and `main` branches synchronized and clean.

---

## 2. Operator Launch Gates Overview

```
[CURRENT BASELINE] Containers Isolated & Hardened, Backups Active, Git Synchronized
       |
       +--> [STEP 1] Cloud Platform Admin Initialization & Workspace Smoke Test
       |
       +--> [STEP 2] Gate 3 - Stripe Live Catalog & Automated Webhook Integration
       |
       +--> [STEP 3] Gate 5 - Transactional Email Deliverability (SPF, DKIM, DMARC, SMTP)
       |
       +--> [STEP 4] Gate 2 & 6 - Qualified Trust Anchor (eIDAS) & Legal Finalization
       |
       +--> [STEP 5] Production Go-Live, Token Revocation & Public Traffic Opening
```

---

## 3. Operator Checklist

* **Initial Cloud Admin Email**: Established as `docurama@voiria.com` on `docurama.eu`.
* **Transactional Email Provider (Gate 5)**: Outbound signing invitations and security notices for `docurama.eu` (e.g. Hostinger SMTP / Resend / Postmark). Automated DNS records (SPF, DKIM, DMARC) managed via Cloudflare API.
* **Stripe Credentials (Gate 3)**: Stripe live API keys (`sk_live_...` and webhook secret `whsec_...`) for subscription billing.
* **GitHub PAT Revocation**: Revoke temporary personal access tokens at GitHub Token Settings once deployments are verified.

---

## 4. Execution Phases

### Step 1: Cloud Platform Admin Initialization & Workspace Smoke Test
* **Objective**: Establish the primary administrative account on Docurama Cloud and verify the 14-day Plus trial engine.
* **Actions**:
  1. Access initial platform admin setup via `https://docurama.eu/admin/setup`.
  2. Verify account bootstrap logic: sets `is_platform_admin = True` and writes to the chained security audit ledger.
  3. Sign into `https://docurama.eu/sign_in` and verify:
     - The 14-day Plus trial banner displays correctly (`Plus Trial - 14 days left`).
     - The Platform Admin console is accessible at `/admin`.
     - Document upload, envelope preparation studio, and signing flow work smoothly.

### Step 2: Gate 3 - Stripe Live Commercial Catalog & Webhook Integration
* **Objective**: Connect Docurama Cloud to Stripe for automated subscription billing and seat management.
* **Catalog Configuration**:
  Create the 5 price objects matching the 35-day cycle engine:
  | Tier | Billing Cycle | Price (EUR) | Description | Env Variable |
  | :--- | :--- | :--- | :--- | :--- |
  | **Plus** | Monthly (35 days) | 19.00 EUR | Single seat, 30 envelopes/cycle | `STRIPE_PRICE_PLUS_MONTHLY` |
  | **Plus** | Annual (12 cycles / 420d) | 180.00 EUR | 15 EUR/cycle equivalent (-20%) | `STRIPE_PRICE_PLUS_ANNUAL` |
  | **Business Team** | Monthly (35 days) | 49.00 EUR | 3 seats included, 100 envelopes | `STRIPE_PRICE_BUSINESS_TEAM_MONTHLY` |
  | **Business Team** | Annual (12 cycles) | 468.00 EUR | 39 EUR/cycle equivalent (-20%) | `STRIPE_PRICE_BUSINESS_TEAM_ANNUAL` |
  | **Business Team Seat** | Monthly (35 days) | 15.00 EUR | Additional seat add-on | `STRIPE_PRICE_BUSINESS_TEAM_SEAT` |
* **Webhook Setup**:
  * Register endpoint in Stripe Dashboard: `https://app.docurama.eu/api/billing/webhook`.
  * Subscribe to: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
* **VPS Activation**:
  * Update `/opt/docurama-cloud/.env`:
    ```env
    DOCURAMA_BILLING_ENABLED=true
    STRIPE_SECRET_KEY=sk_live_...
    STRIPE_WEBHOOK_SECRET=whsec_...
    STRIPE_PRICE_PLUS_MONTHLY=price_...
    STRIPE_PRICE_PLUS_ANNUAL=price_...
    STRIPE_PRICE_BUSINESS_TEAM_MONTHLY=price_...
    STRIPE_PRICE_BUSINESS_TEAM_ANNUAL=price_...
    STRIPE_PRICE_BUSINESS_TEAM_SEAT=price_...
    ```
  * Restart `docurama-cloud-api` and test checkout link generation via `https://docurama.eu/pricing`.

### Step 3: Gate 5 - Transactional Email & Deliverability Configuration
* **Objective**: Ensure signing invitations and notifications reach inboxes reliably with complete cryptographic email authentication.
* **DNS Setup on Cloudflare (`docurama.eu`)**:
  * **SPF**: `TXT @ "v=spf1 include:_spf.mail.hostinger.com ~all"`
  * **DKIM**: Configure TXT / CNAME records specified by email provider.
  * **DMARC**: `TXT _dmarc "v=DMARC1; p=quarantine; rua=mailto:abuse@docurama.eu; pct=100"`
  * **MX**: Configure mail exchanger records for inbound email.
* **Configuration**:
  Update `/opt/docurama-cloud/.env` with SMTP credentials:
  ```env
  SMTP_HOST=smtp.hostinger.com
  SMTP_PORT=587
  SMTP_USERNAME=notifications@docurama.eu
  SMTP_PASSWORD=...
  SMTP_FROM_EMAIL=notifications@docurama.eu
  SMTP_FROM_NAME="Docurama Sign"
  SMTP_USE_TLS=true
  ```

### Step 4: Gate 2 & 6 - Qualified Trust Anchor & Legal Finalization
* **Objective**: Seal production documents with trusted certificates and publish legal terms.
* **Actions**:
  1. Inspect root and intermediate certificate stores in `/opt/docurama-cloud/backend/certs/`.
  2. Confirm TSA (Time Stamping Authority) endpoints for RFC 3161 timestamps.
  3. Validate legal pages at `https://docurama.eu/legal`, `https://docurama.eu/compliance`, and `https://docurama.eu/trust`.

### Step 5: Public Production Traffic Opening
* **Objective**: Open the gates for public sign-ups and marketing campaigns.
* **Actions**:
  1. Run end-to-end smoke test: create workspace -> invite signer -> sign document -> verify cryptographic seal.
  2. Verify backup timer and check first automated snapshot in `/opt/docurama-cloud/backups/`.
  3. Public availability confirmed.
