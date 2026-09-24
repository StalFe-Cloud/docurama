# Payments & Billing — Operator + Integration Guide

Everything billed flows through `src/lib/payments.ts` (rails) and `src/lib/stripe-catalog.ts` (Stripe catalog, portal, webhook event list). Two modes, selected by environment:

| Mode | Enabled by | Checkout | Renewal driver |
|---|---|---|---|
| **stripe** | `PAYMENT_PROVIDER=stripe` **and** `STRIPE_SECRET_KEY` set | Stripe Checkout (subscription mode) | `invoice.paid` webhook → `renewPaidTerm()` |
| **manual** (default) | anything else | PENDING Payment + bank reference | background worker → `renewDueSubscriptions()` |

Both modes converge on `activateSubscription()` / `renewPaidTerm()` so the `Payment` ledger, audit trail and receipt mail are identical regardless of provider.

## 1. Stripe setup, step by step

1. **Keys.** Use a restricted key (`rk_live_…`) with write access to: Products, Prices, Customers, Checkout Sessions, Subscriptions, Customer portal, Webhook endpoints (setup script only); read access to Charges and Disputes. A full secret key works too.
2. **Provision the catalog, portal and webhook** (idempotent — re-run after any price change):
   ```bash
   STRIPE_SECRET_KEY=rk_live_… bun scripts/stripe-setup.ts --origin https://app.docurama.eu --webhook-url https://app.docurama.eu/api/billing/webhook
   ```
   It creates, all tagged `metadata.app=docurama`:
   - Products `docurama_solo`, `docurama_starter`, `docurama_business` (tax code `txcd_10103001` SaaS/B2B, statement descriptor `DOCURAMA`);
   - one recurring EUR Price per plan × term, lookup keys `docurama_<plan>_<1|3|6|12>m`, VAT-exclusive by default;
   - the Docurama customer-portal configuration (payment method, billing details, tax id, invoice history, cancel at period end — plan changes go through Checkout);
   - the webhook endpoint pinned to API version `2026-08-26.dahlia` with exactly the events in §5. A **new** endpoint's signing secret is printed once.
   The app also ensures catalog and portal lazily on first use, so a missed step self-heals — but run the script before launch so the dashboard is complete.
3. **Env** (compose passes these through from the `.env` next to `docker-compose.yml`): `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Optional: `STRIPE_AUTOMATIC_TAX=true` (after activating Stripe Tax), `STRIPE_TAX_BEHAVIOR=inclusive`, `BILLING_GRACE_DAYS` (default 14), `BILLING_ENFORCEMENT=off`.
4. **Check** `GET /api/health` → `checks.billing = { mode: "stripe", ready: true }` (the server log warns when the webhook secret is missing). Stripe mode **refuses checkouts (503)** while `STRIPE_WEBHOOK_SECRET` is missing — money would otherwise be taken for plans that can never activate.
5. **Test mode first**: repeat with `sk_test_…`/a staging origin, buy with `4242 4242 4242 4242`, then run the §8 checklist.

### Switching test → live

Stripe customers, subscriptions and prices are per mode. Local `PaymentCustomer` rows that point at test customers are detected (customer missing on the live key) and replaced on the next checkout. Test subscriptions in the local database are **not** migrated — wipe test tenants/subscriptions from a database that will go live, or start live on a fresh database.

### Shared Stripe account

The STALFE account also serves other products (NEXA). Docurama therefore:
- tags everything it creates with `metadata.app=docurama` (customers, products, prices, sessions, subscriptions, portal configuration);
- **acknowledges foreign webhook events with 200 and does nothing** (a 5xx would be retried for days until Stripe disables the endpoint) — ownership is proven by metadata or a local payment/customer/subscription row;
- passes its own portal configuration explicitly (the account default is untouched in behaviour, though Stripe makes the first configuration created the default);
- shows **Docurama** on Checkout (`branding_settings.display_name`) and `DOCURAMA` on card statements (product statement descriptor).

Account-level settings still shared with the other product: payment method configuration, customer emails, Smart Retries/dunning schedule, invoice template and public business name. A dedicated Stripe account for Docurama removes all of that coupling and is the cleaner long-term setup.

## 2. Plans, trials and money math

`termCents = monthlyEur × (100 − discountPct) × months` (already euro-cents). Prices exclude VAT.

| Plan | Monthly | 3 mo (−5%) | 6 mo (−10%) | 12 mo (−20%) | Free trial |
|---|---|---|---|---|---|
| Solo | €12 | €34.20 | €64.80 | €115.20 | **14 days** (PlatformSetting `trialLengthDays`) |
| Starter | €29 | €82.65 | €156.60 | €278.40 | none — pay to activate |
| Business | €79 | €225.15 | €426.60 | €758.40 | none — pay to activate |
| Enterprise | **Custom** | — | — | — | sales-led |

Enterprise shows "Custom" for price, seats, envelopes and storage everywhere; the negotiated values are set on the subscription (`monthlyEurOverride`, `seatLimitOverride`, `envelopeLimitOverride`) by the admin `lead.convert` op. The catalogue remains in `src/lib/plans.ts`; a price change there mints a new Stripe Price on the next checkout (lookup key moves, old price archived) and existing subscriptions are **not** repriced.

## 3. Paid-plan enforcement (Stripe mode only)

`billingBlock()` in `src/lib/billing.ts` pauses **new envelopes** (402 with a specific message; signing, verification and downloads of existing envelopes continue):

| Reason | When |
|---|---|
| `payment_required` | Starter/Business signup (zero-length trial) not paid yet |
| `trial_expired` | Solo trial (or a grandfathered pre-change trial) ended without payment |
| `past_due` | renewal charge failed and `BILLING_GRACE_DAYS` (default 14) have passed |
| `canceled` | subscription ended and its paid term is over |

Workspaces without a trial end date (admin-provisioned, sales-led) are never blocked. Manual/self-hosted installs are never blocked; `BILLING_ENFORCEMENT=off` is the operator escape hatch. **Before enabling Stripe on an existing database**, review TRIAL workspaces whose trial already ended — they will be asked to pay on their next send.

## 4. Checkout, activation, plan changes

- **Checkout** records the PENDING `Payment` row first, then creates the session (EUR only — Adaptive Pricing off) with the catalog Price, `metadata.paymentId`, `subscription_data.metadata` (tenant, plan, term), required billing address, tax-id collection, optional Stripe Tax. Buying the plan+term already paid for is refused (409).
- **Activation** requires a paid `checkout.session.completed` / `checkout.session.async_payment_succeeded` and the matching PENDING row. The provider's recurring-item service-period end becomes the local paid-through date. Payment, subscription, tenant plan (TRIAL → ACTIVE), audit and receipt (amount actually charged, tax included) commit in one transaction.
- **Plan/term change** = a new Checkout subscription. After it activates, every other live subscription on the tenant's Stripe customer is canceled with `prorate + invoice_now` — the unused time becomes customer credit applied to the next invoice — and `subscription.superseded` is audited. Replays never cancel the current subscription.
- **Renewals**: only `invoice.paid` with `billing_reason=subscription_cycle` renews, using the invoice's service period and paid amount; initial invoices are owned by activation. A renewal for our subscription that is not active locally is retried (activation in flight) unless Stripe reports it canceled (superseded) — no retry storms.
- **Manual subscriptions** are renewed by the worker (`renewDueSubscriptions`), which skips Stripe-managed rows.

## 5. Webhook events

`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created` (source of truth: `STRIPE_WEBHOOK_EVENTS`).

Every event's signature is verified over the raw body; a bad signature is 400 + audited `billing.webhook_rejected`; a handler error is 500 so Stripe retries (all handlers are idempotent). The response carries `handled: false` for foreign or irrelevant events.

## 6. Dunning, cancellation, refunds, disputes

| Stripe event | Effect |
|---|---|
| `invoice.payment_failed` | **PAST_DUE** + `failedPayment`, CRITICAL audit, mail to OWNER/ADMIN; sending pauses after the grace period |
| `checkout.session.async_payment_failed` | checkout **FAILED**, WARNING audit, mail to OWNER/ADMIN |
| `checkout.session.expired` | abandoned checkout **CANCELED** |
| `customer.subscription.updated` | audit `subscription.cancel_scheduled` / `cancel_reverted` (portal) |
| `customer.subscription.deleted` | **CANCELED**; data kept, sending stops when the paid term ends |
| `charge.refunded` | one `REFUNDED` ledger row per refunded increment; plan unchanged — cancel the subscription in Stripe too if service should stop |
| `charge.dispute.created` | CRITICAL audit `billing.dispute_opened` with the evidence due date |

Recovery from PAST_DUE: the customer updates the card in the portal (Settings → Billing → Manage payment method) and Stripe retries; the next paid invoice returns the subscription to ACTIVE. Admin op **retry-payment** clears the flag after confirming settlement out-of-band.

## 7. Manual mode operations

1. Tenant picks a plan/term in Settings → Billing → checkout records a **PENDING Payment** with a quotable reference (`DRM-…`) plus SEPA instructions (billing@docurama.eu).
2. Tenant transfers the term total, quoting the reference.
3. Admin console → Billing → **payment.approve** (bank-reference note mandatory) → `activateSubscription()`, the same path as Stripe.

Other admin ops: `payment.cancel` (PENDING only), `cancel-subscription` (reason required, cancels at period end).

## 8. Go-live verification (live mode)

1. `GET /api/health` → `checks.billing.ready: true`; the key in use is the live one (`rk_live_…`/`sk_live_…`).
2. Real card purchase of Solo monthly on a real workspace → plan ACTIVE within seconds, receipt mail, Stripe invoice shows "DOCURAMA".
3. Change that workspace to Starter monthly → old subscription canceled with credit; one active subscription remains in Stripe.
4. Refund the charge in the dashboard → `REFUNDED` row in Settings → Billing history; cancel the subscription → CANCELED.
5. Dashboard → Webhooks → endpoint shows only 2xx deliveries (including other products' events).

## 9. Testing

`e2e/billing.test.ts` is hermetic — a fresh temporary SQLite schema, an in-process Stripe stub (`STRIPE_API_BASE`) that models products, prices/lookup keys, portal configurations, subscription listing/cancellation and charges, and webhook payloads signed with `generateTestHeaderStringAsync()`. It covers the money ladder, the manual path, Stripe checkout/customer/portal, catalog price resolution and price changes, signature rejection, paid/async activation, renewals, PAST_DUE + dunning, cancellation, replay/out-of-order safety, **foreign events on a shared account**, **plan-change retirement**, expired/failed checkouts, refunds/disputes, the webhook-secret guard, customer re-mapping, and **paid-plan enforcement** (Solo-only trial, grace, cancellations).

```bash
bun test e2e/billing.test.ts
E2E_SKIP_BILLING=1 bash e2e/run.sh   # skip the billing suite
```

The suite owns its `PAYMENT_PROVIDER`/`STRIPE_*` env, so it never touches a real Stripe account.
