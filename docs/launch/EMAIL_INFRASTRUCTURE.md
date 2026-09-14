# Email Infrastructure & Deliverability Architecture

This guide specifies the operational email addresses, forwarding topology, and DNS deliverability configuration for **Docurama Cloud** (`docurama.eu`).

---

## 1. Essential Transactional & System Mailboxes (SMTP)

Used directly by the Docurama backend services to send signature requests, OTPs, verification emails, and notifications.

| Email Address | Purpose | Setup Type |
| :--- | :--- | :--- |
| **`notifications@docurama.eu`** <br>*(or `noreply@docurama.eu`)* | Outbound signing invitations, completion certificates, envelope audit events, and password resets. Configured in Docurama SMTP settings. | **Real Mailbox** *(Needs SMTP credentials)* |
| **`admin@docurama.eu`** | Platform administrator alerts, database/cert expiry warnings, security ledger notices, and system bootstrap. | **Real Mailbox** *(Or forwarder to `docurama@voiria.com`)* |

> **Display Name Configuration:** When sending via Docurama, configure the sender name as `Docurama Sign <notifications@docurama.eu>` for high deliverability and user trust.

---

## 2. Business, Sales & Customer Support

Handles customer-facing interactions, enterprise sales leads, and subscription inquiries.

| Email Address | Purpose | Setup Type |
| :--- | :--- | :--- |
| **`support@docurama.eu`** | Customer technical support, user inquiries, onboarding assistance. | **Real Mailbox** or Shared Inbox |
| **`sales@docurama.eu`** | Inquiries for Enterprise sales, custom self-hosted deployments, and high-volume quotas. | **Alias / Forwarder** -> `admin` |
| **`billing@docurama.eu`** | Invoices, VAT receipts, payment notifications, and subscription inquiries. | **Alias / Forwarder** -> `admin` |
| **`contact@docurama.eu`** <br>*(or `hello@docurama.eu`)* | General inquiries, partnership requests, and website contact form fallback. | **Alias / Forwarder** -> `support` |

---

## 3. Legal, Privacy & Compliance (GDPR / eIDAS)

Because Docurama processes electronic signatures, audit trails, and customer contracts, dedicated compliance points of contact are required by GDPR and eIDAS regulations.

| Email Address | Purpose | Setup Type |
| :--- | :--- | :--- |
| **`privacy@docurama.eu`** <br>*(or `dpo@docurama.eu`)* | GDPR data subject access requests (DSAR), deletion requests, and Data Protection Officer communications. | **Alias / Forwarder** -> `admin` |
| **`legal@docurama.eu`** | Terms of Service updates, Subprocessor notifications, dispute resolution, and official legal notices. | **Alias / Forwarder** -> `admin` |
| **`security@docurama.eu`** | Vulnerability disclosure, bug reports, and security audit verifications. | **Alias / Forwarder** -> `admin` |

---

## 4. RFC Internet Standards & Mail Reputation (Deliverability)

These mailboxes are required under RFC 5321 and RFC 2142. Without them, automated spam algorithms at major providers (Gmail, Outlook, Yahoo) may penalize sender reputation.

| Email Address | Purpose | Setup Type |
| :--- | :--- | :--- |
| **`postmaster@docurama.eu`** | RFC 5321 requirement for mail server administration and deliverability. | **Alias / Forwarder** -> `admin` |
| **`abuse@docurama.eu`** | RFC 2142 requirement for phishing, spam, or malicious document reports. | **Alias / Forwarder** -> `admin` |
| **`dmarc@docurama.eu`** | Destination for incoming DMARC aggregate reports (`rua`) to monitor SPF/DKIM alignment. | **Alias / Forwarder** |

---

## 5. Cost-Effective Setup Strategy

To avoid paying for separate commercial mailboxes for every functional role:

1. **Create 2 Dedicated Mailboxes** (with storage & SMTP passwords):
   - `notifications@docurama.eu` (used for outbound transactional SMTP in Docurama)
   - `admin@docurama.eu` (or `support@docurama.eu` for incoming communications)
2. **Create Email Forwarders / Aliases for All Others**:
   - `sales@`, `billing@`, `privacy@`, `legal@`, `security@`, `abuse@`, `postmaster@` -> Forward all to your primary mailbox (e.g. `docurama@voiria.com` or `admin@docurama.eu`).

---

## 6. DNS Records for Email Deliverability (Cloudflare)

When pointing email services for `docurama.eu`:
1. **MX Records**:
   - `Priority 10`: `mx1.hostinger.com`
   - `Priority 20`: `mx2.hostinger.com`
2. **SPF (TXT)**:
   - Name: `@`
   - Value: `v=spf1 include:_spf.mail.hostinger.com ~all`
3. **DKIM**:
   - Add the TXT or CNAME selector provided by the email host control panel.
4. **DMARC (TXT)**:
   - Name: `_dmarc`
   - Value: `v=DMARC1; p=quarantine; rua=mailto:abuse@docurama.eu; pct=100`
