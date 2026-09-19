# Payments & Billing — Operator + Integration Guide

Everything billed flows through `src/lib/payments.ts`. Two modes, selected by environment:

| Mode | Enabled by | Checkout | Renewal driver |
|---|---|---|---|
| **stripe** | `PAYMENT_PROVIDER=stripe` **and** `STRIPE_SECRET_KEY` set | Stripe Checkout (subscription mode) | `invoice.paid` webhook → `renewPaidTerm()` |
| **manual** (default) | anything else | PENDING Payment + bank reference | background worker → `renewDueSubscriptions()` |

Both modes converge on `activateSubscription()` / `renewPaidTerm()` so the `Payment` ledger, audit trail and receipt mail are identical regardless of provider.

## 1. Stripe setup, step by step

1. **No product/price creation needed.** Checkout sessions are created with inline `price_data` (currency EUR, `unit_amount` = computed term cents, `recurring: { interval: "month", interval_count: termMonths }`) — nothing to pre-register in the Stripe catalog.
2. Set env vars: `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY=sk_live_…`, and (after step 3) `STRIPE_WEBHOOK_SECRET=whsec_…`.
3. Register the webhook endpoint in the Stripe dashboard: `https://app.<root>/api/billing/webhook`, events **`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`**. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Test with test cards (`4242 4242 4242 4242`) in test mode before flipping live keys.

The route verifies every event's signature (`constructEventAsync` over the raw body) before acting; a bad signature is 400 + an audited `billing.webhook_rejected`, a handler error is 500 so **Stripe retries** (safe — activation is idempotent per payment row).

## 2. Money math

`termCents = monthlyEur × (100 − discountPct) × months` (already euro-cents):

| Plan | Monthly | 3 mo (−5%) | 6 mo (−10%) | 12 mo (−15%) |
|---|---|---|---|---|
| Solo | €12 | €34.20 | €64.80 | €122.40 |
| Starter | €19 | €54.15 | €102.60 | 19×85×12 = **19380 c = €193.80** |
| Smart Team | €79 | €225.15 | €426.60 | €805.80 |
| Business | €199 | €567.15 | €1,074.60 | €2,029.80 |

Enterprise is sales-led (custom contracts; catalog anchor €349). Billing terms: monthly (no engagement) / 3 mo −5% / 6 mo −10% / 12 mo −15%, discounts applied to the whole term.

## 3. Renewal model

- **Stripe subscriptions** charge automatically every `termMonths` (`interval_count`). On `invoice.paid`, `renewPaidTerm(subscriptionId, invoiceRef)` advances the term by `termMonths`, computes rollover for the closed period (unused envelopes carried forward, capped at one monthly allowance) and records an audited `subscription.renewed` + a PAID renewal `Payment` row. The first term is already handled by `checkout.session.completed`, so the route skips `invoice.paid` events it has already receipted.
- **Manual subscriptions** are renewed by the worker pass (`renewDueSubscriptions`, src/lib/billing.ts), which explicitly **skips Stripe-managed rows** (`provider="stripe"` / `providerRef=sub_…`) — never double-advance those by hand.

## 4. Manual mode operations

1. Tenant picks a plan/term in Settings → Billing → checkout records a **PENDING Payment** with a quotable reference (`DRM-…`) plus SEPA instructions (billing@docurama.eu contact).
2. Tenant transfers the term total, quoting the reference.
3. Admin console → Billing section → find the PENDING payment → **payment.approve**. The bank-reference note is **mandatory** (API rejects empty notes) — it lands on the payment row and in the audit detail.
4. Approval runs `activateSubscription()` — the exact same path as a Stripe checkout completion (plan set on tenant, subscription upserted ACTIVE, receipt mail queued, `subscription.activated` audited). Idempotent: replayed webhooks or double-clicked approvals are no-ops.

Other admin ops: `payment.cancel` (PENDING only), `cancel-subscription` (reason required, cancels at period end).

## 5. Dunning & cancellation

| Stripe event | Effect |
|---|---|
| `invoice.payment_failed` | `markPastDue()` → subscription **PAST_DUE** + `failedPayment=true`, CRITICAL audit `subscription.payment_failed`, mail to the tenant's OWNER/ADMIN with update-payment instructions |
| — | Recovery: customer updates card in the Stripe billing portal (Settings → Billing → Manage payment method) and Stripe retries, or admin op **retry-payment** clears the flag and sets ACTIVE after confirming settlement |
| `customer.subscription.deleted` | `markCanceled()` → **CANCELED**; workspace data kept, plan stays active until the paid term ends |

Watch the PAST_DUE queue daily post-launch (admin Billing section); sending pauses for past-due workspaces after a grace period.

## 6. Testing

`e2e/billing.test.ts` is fully hermetic — it runs against a scratch copy of `db/custom.db`, stubs the Stripe API with an in-process server pointed at by **`STRIPE_API_BASE`**, and signs webhook payloads with `stripe.webhooks.generateTestHeaderStringAsync()`. Covered: the money-math ladder (Solo €12 … Business €199), the full manual path (checkout → PENDING → approval/activation → PAID, audit, receipt mail, idempotency), Stripe checkout/customer/portal against the stub, and every webhook branch (not-configured 400, bad signature 400, activation, renewal with rollover, PAST_DUE + dunning mail, CANCELED).

```bash
bun test e2e/billing.test.ts     # via e2e/run.sh (wired with scratch DATABASE_URL)
E2E_SKIP_BILLING=1 bash e2e/run.sh   # skip the billing suite (e.g. no network on CI box)
```

The suite owns its `PAYMENT_PROVIDER`/`STRIPE_*` env, so it never touches a live Stripe account.
