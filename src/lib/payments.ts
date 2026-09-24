import { createHash } from "crypto";
import Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { planDef, termCents, termFor } from "@/lib/plans";
import { monthlyWindow, shiftUtcMonth, usageAnchor } from "@/lib/monthly-period";
import { serializableTransaction } from "@/lib/transaction";
import { STRIPE_API_VERSION, STRIPE_APP, ensurePlanPrice, ensurePortalConfiguration, resetStripeCatalogCache, stripeAutomaticTax } from "@/lib/stripe-catalog";

export { termCents };

/**
 * Payment provider rails (go-live cycle).
 *
 * Two modes, selected by environment:
 *
 *   stripe  — PAYMENT_PROVIDER=stripe + STRIPE_SECRET_KEY. Self-serve
 *             checkout over Stripe Checkout (subscription mode: the chosen
 *             term is charged every termMonths automatically). Renewals are
 *             webhook-driven (invoice.paid advances the term in-app,
 *             invoice.payment_failed flips the subscription to PAST_DUE) —
 *             the platform's own renewal worker never touches Stripe-managed
 *             subscriptions.
 *
 *   manual  — default, and the self-host / out-of-band mode. Checkout
 *             records a PENDING Payment with a bank reference; the customer
 *             pays by transfer/SEPA; a platform admin approves it in the
 *             admin console (Billing section), which runs the exact same
 *             activation path as a Stripe checkout.session.completed event.
 *             The platform's renewal worker renews manual subscriptions when
 *             the term elapses (pre-existing behaviour, unchanged).
 *
 * Both modes converge on activateSubscription() / renewPaidTerm() so the
 * ledger (Payment rows), audit trail and mail receipts are identical.
 */

export type PaymentMode = "stripe" | "manual";

export function paymentMode(): PaymentMode {
  return process.env.PAYMENT_PROVIDER === "stripe" && process.env.STRIPE_SECRET_KEY ? "stripe" : "manual";
}

/** Test seam: point the Stripe SDK at a local stub server (STRIPE_API_BASE). */
function stripeHostConfig(): Pick<Stripe.StripeConfig, "host" | "port" | "protocol"> | undefined {
  const base = process.env.STRIPE_API_BASE;
  if (!base || !/^https?:\/\//.test(base)) return undefined;
  try {
    const u = new URL(base);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80,
      protocol: u.protocol.replace(":", "") as "http" | "https",
    };
  } catch {
    return undefined;
  }
}

let stripeSingleton: Stripe | null = null;

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY ?? "sk_test_disabled";
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(key, {
      apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
      maxNetworkRetries: 2,
      ...stripeHostConfig(),
    });
  }
  return stripeSingleton;
}

/** Test seam: reset the singleton when the api base changes. */
export function resetStripeClient(): void {
  stripeSingleton = null;
  resetStripeCatalogCache();
}

/** Stripe is selected but cannot take money safely (e.g. no webhook secret). */
export class BillingUnavailableError extends Error {}

/**
 * Operator-facing Stripe posture for /api/health — booleans only, never key
 * material. `ready` is false when checkouts would take money that could never
 * activate a plan (no webhook secret).
 */
export function stripePosture() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  const webhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  return {
    livemode: /^(sk|rk)_live_/.test(key),
    webhookConfigured,
    automaticTax: stripeAutomaticTax(),
    ready: paymentMode() === "stripe" && webhookConfigured,
  };
}

// ─── Money math ───────────────────────────────────────────────────────────────

export function centsToEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

// ─── Checkout ────────────────────────────────────────────────────────────────

const MANUAL_INSTRUCTIONS = `Transfer the term total to Docurama SAS (SEPA / bank transfer) with the payment reference shown below as the communication. Your plan activates as soon as our billing team confirms the transfer (usually one business day). Questions: billing@docurama.eu.`;

export interface CheckoutResult {
  mode: PaymentMode;
  /** Stripe Checkout URL (stripe mode) — redirect the customer here. */
  url?: string;
  /** Manual payment reference to quote on the bank transfer. */
  reference: string;
  amountCents: number;
  instructions?: string;
}

export async function createCheckout(input: {
  tenantId: string;
  tenantName: string;
  userEmail: string;
  userName: string;
  planCode: string;
  termMonths: number;
  origin: string;
}): Promise<CheckoutResult> {
  const plan = planDef(input.planCode);
  const term = termFor(input.termMonths);
  const amountCents = termCents(input.planCode, input.termMonths);
  const description = `${plan.name} plan — ${term.months}-month term${term.discountPct ? ` (−${term.discountPct}%)` : ""}`;

  if (paymentMode() === "stripe") {
    // Without the signing secret no paid checkout could ever activate a plan:
    // refuse to take money rather than charge customers into a void.
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      throw new BillingUnavailableError("STRIPE_WEBHOOK_SECRET is not set; paid checkouts cannot activate plans");
    }
    const stripe = stripeClient();
    const customer = await getOrCreateStripeCustomer(input.tenantId, input.userEmail, `${input.userName} · ${input.tenantName}`);
    const price = await ensurePlanPrice(stripe, input.planCode, term.months);

    // Record the ledger row first so a paid session can always be matched,
    // even if this process dies between Stripe answering and the DB write.
    const payment = await db.payment.create({
      data: {
        tenantId: input.tenantId,
        provider: "stripe",
        kind: "checkout",
        planCode: input.planCode,
        termMonths: term.months,
        amountCents,
        status: "PENDING",
        description,
      },
    });
    const identity = { app: STRIPE_APP, tenantId: input.tenantId, planCode: input.planCode, termMonths: String(term.months) };

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customer.externalId,
        client_reference_id: input.tenantId,
        metadata: { ...identity, paymentId: payment.id },
        // Copied onto the subscription and every invoice it generates, so
        // renewals are attributable on an account shared with other products.
        subscription_data: { metadata: identity, description },
        line_items: [{ price, quantity: 1 }],
        billing_address_collection: "required",
        customer_update: { address: "auto", name: "auto" },
        tax_id_collection: { enabled: true },
        automatic_tax: { enabled: stripeAutomaticTax() },
        // Charge exactly the published EUR catalogue price — no local-currency
        // conversion, so receipts, ledger and renewals all stay in euros.
        adaptive_pricing: { enabled: false },
        branding_settings: { display_name: "Docurama" },
        locale: "auto",
        success_url: `${input.origin}/settings/billing?checkout=success`,
        cancel_url: `${input.origin}/settings/billing?checkout=canceled`,
      }, { idempotencyKey: `docurama-checkout-${payment.id}` });
    } catch (err) {
      await db.payment.update({ where: { id: payment.id }, data: { status: "CANCELED", approverNote: "Stripe Checkout session could not be created" } });
      throw err;
    }

    await db.payment.update({ where: { id: payment.id }, data: { reference: session.id, checkoutUrl: session.url ?? undefined } });
    return { mode: "stripe", url: session.url ?? undefined, reference: session.id, amountCents };
  }

  // Manual mode: bank transfer with a quoteable reference.
  const reference = `DRM-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  await db.payment.create({
    data: {
      tenantId: input.tenantId,
      provider: "manual",
      kind: "checkout",
      planCode: input.planCode,
      termMonths: input.termMonths,
      amountCents,
      status: "PENDING",
      reference,
      description,
    },
  });
  return { mode: "manual", reference, amountCents, instructions: MANUAL_INSTRUCTIONS };
}

/**
 * The tenant's live Stripe customer. A mapping to a customer that no longer
 * exists on this key (deleted in the dashboard, or minted with test keys
 * before the switch to live) is replaced instead of failing every checkout.
 */
async function getOrCreateStripeCustomer(tenantId: string, email: string, name: string) {
  const where = { tenantId_provider: { tenantId, provider: "stripe" } };
  const stripe = stripeClient();
  const existing = await db.paymentCustomer.findUnique({ where });
  if (existing) {
    const found = await retrieveCustomer(stripe, existing.externalId);
    if (found) return existing;
    await db.paymentCustomer.deleteMany({ where: { id: existing.id } });
  }
  // Same tenant + details within 24h → same customer (double-clicked checkout).
  const fingerprint = createHash("sha256").update(`${email}\n${name}`).digest("hex").slice(0, 16);
  const customer = await stripe.customers.create(
    { email, name, metadata: { app: STRIPE_APP, tenantId } },
    { idempotencyKey: `docurama-customer-${tenantId}-${fingerprint}` },
  );
  try {
    return await db.paymentCustomer.create({ data: { tenantId, provider: "stripe", externalId: customer.id } });
  } catch (err) {
    // A concurrent checkout mapped the tenant first; keep its customer.
    const winner = await db.paymentCustomer.findUnique({ where });
    if (winner) return winner;
    throw err;
  }
}

async function retrieveCustomer(stripe: Stripe, customerId: string): Promise<Stripe.Customer | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer.deleted ? null : customer;
  } catch (err) {
    if ((err as { code?: string }).code === "resource_missing") return null;
    throw err;
  }
}

// ─── Activation (shared by Stripe webhook and manual admin approval) ─────────

export interface ActivateResult {
  subscriptionId: string;
  renewalAt: Date;
  planCode: string;
  termMonths: number;
}

/**
 * Activate (or change) a tenant's plan for a paid term. Idempotent per
 * payment row: a replayed webhook or a double-clicked approval is a no-op.
 */
export async function activateSubscription(input: {
  tenantId: string;
  planCode: string;
  termMonths: number;
  provider: "stripe" | "manual";
  providerRef?: string | null;
  paymentId?: string | null;
  paymentReference?: string | null;
  /** Authoritative paid service-period end from Stripe; manual terms use now. */
  providerPeriodEnd?: Date;
  /** What the customer was actually charged (Stripe amount_total, tax included). */
  amountPaidCents?: number | null;
  actor: string;
  actorRole: string;
  note?: string;
}): Promise<ActivateResult> {
  const plan = planDef(input.planCode);
  const term = termFor(input.termMonths);
  const now = new Date();
  const renewalAt = shiftUtcMonth(now, term.months);
  const amountCents = Number.isSafeInteger(input.amountPaidCents) && input.amountPaidCents! >= 0
    ? input.amountPaidCents!
    : termCents(input.planCode, input.termMonths);
  const paidUntil = input.provider === "stripe" ? input.providerPeriodEnd : renewalAt;
  if (!paidUntil || !Number.isFinite(paidUntil.getTime())) throw new Error("A valid provider service-period end is required");

  return serializableTransaction(async (tx) => {
    const payment = input.paymentId
      ? await tx.payment.findUnique({ where: { id: input.paymentId } })
      : input.paymentReference ? await tx.payment.findFirst({ where: { provider: input.provider, reference: input.paymentReference } }) : null;
    if (!payment || payment.tenantId !== input.tenantId || payment.provider !== input.provider ||
        payment.kind !== "checkout" || payment.planCode !== input.planCode || payment.termMonths !== term.months) {
      throw new Error("Activation must match a recorded checkout payment");
    }
    const existing = await tx.subscription.findFirst({ where: { tenantId: input.tenantId }, orderBy: { renewalAt: "desc" } });
    if (payment.status === "PAID") {
      if (!existing) throw new Error("Paid checkout has no subscription");
      return { subscriptionId: existing.id, renewalAt: existing.renewalAt, planCode: existing.planCode, termMonths: existing.termMonths };
    }
    if (payment.status !== "PENDING") throw new Error("Only pending checkout payments can activate subscriptions");
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "PAID", paidAt: new Date(), approverNote: input.note },
    });
    if (claimed.count !== 1) throw new Error("Checkout payment changed during activation");
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: input.tenantId }, select: { status: true } });
    // A paid plan ends the trial. SUSPENDED is an admin decision and stays.
    const tenant = await tx.tenant.update({
      where: { id: input.tenantId },
      data: { planCode: input.planCode, ...(before.status === "TRIAL" ? { status: "ACTIVE" } : {}) },
    });

    const usage = monthlyWindow(existing ? { ...existing, usageAnchorAt: usageAnchor(existing, now) } : { renewalAt: paidUntil, termMonths: term.months, usageAnchorAt: now }, now);
    const metering = existing
      ? { usageAnchorAt: existing.usageAnchorAt ?? usage.anchor }
      : { usageAnchorAt: usage.anchor, usagePeriodStart: usage.start, usagePeriodEnd: usage.end };
    const sub = await tx.subscription.upsert({
      where: { id: existing?.id ?? "" },
      update: {
        ...metering, paymentAnchorAt: now,
        planCode: input.planCode,
        status: "ACTIVE",
        mrrEur: plan.monthlyEur,
        renewalAt: paidUntil,
        termMonths: term.months,
        discountPct: term.discountPct,
        failedPayment: false,
        lastInvoiceAt: new Date(),
        provider: input.provider,
        ...(input.providerRef !== undefined ? { providerRef: input.providerRef } : {}),
      },
      create: {
        ...metering, paymentAnchorAt: now,
        tenantId: input.tenantId,
        planCode: input.planCode,
        status: "ACTIVE",
        mrrEur: plan.monthlyEur,
        seats: Math.min(plan.seatLimit, 10),
        renewalAt: paidUntil,
        termMonths: term.months,
        discountPct: term.discountPct,
        paymentMethod: input.provider === "stripe" ? "Stripe" : "Bank transfer",
        provider: input.provider,
        providerRef: input.providerRef ?? null,
        lastInvoiceAt: new Date(),
      },
    });

    await tx.auditEvent.create({
      data: {
        actor: input.actor,
        actorRole: input.actorRole,
        action: "subscription.activated",
        resource: `tenant:${tenant.slug}`,
        tenantId: tenant.id, tenantName: tenant.name,
        ip: "system",
        severity: "WARNING",
        detail:
          `${plan.name} activated for ${term.months} month(s) via ${input.provider}` +
          `${term.discountPct ? ` (term −${term.discountPct}%)` : ""} — ${centsToEur(amountCents)}.` +
          (input.note ? ` Note: ${input.note}` : ""),
      },
    });

    await queueReceiptMail(input.tenantId, plan.name, term.months, amountCents, paidUntil, tx);

    return { subscriptionId: sub.id, renewalAt: paidUntil, planCode: input.planCode, termMonths: term.months };
  });
}

/** Renewal of a Stripe-managed subscription: one term paid, rollover computed. */
export async function renewPaidTerm(subscriptionId: string, invoiceRef: string, paidPeriodEnd: Date, amountPaidCents: number, actor = "Docurama Billing"): Promise<void> {
  if (!Number.isFinite(paidPeriodEnd.getTime()) || !Number.isSafeInteger(amountPaidCents) || amountPaidCents < 0) throw new Error("Invalid paid invoice period or amount");
  await serializableTransaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { id: subscriptionId }, include: { tenant: true } });
    if (!sub || sub.provider !== "stripe") throw new Error("Stripe subscription is not activated yet");
    if (await tx.payment.findFirst({ where: { provider: "stripe", reference: invoiceRef, status: "PAID" } })) return;

    // A delayed invoice must neither rewind the paid-through date nor reactivate
    // a canceled subscription. Keep its receipt in the ledger exactly once.
    const advances = paidPeriodEnd > sub.renewalAt && sub.status !== "CANCELED";

    // Payment receipts never award monthly rollover; the usage engine does it once.
    const plan = planDef(sub.planCode);
    const anchor = usageAnchor(sub);

    const renewalAt = advances ? paidPeriodEnd : sub.renewalAt;

    if (advances) await tx.subscription.update({
      where: { id: sub.id },
      data: { renewalAt, usageAnchorAt: sub.usageAnchorAt ?? anchor, status: "ACTIVE", failedPayment: false, lastInvoiceAt: new Date() },
    });
    await tx.payment.create({
      data: {
        tenantId: sub.tenantId,
        provider: sub.provider ?? "manual",
        kind: "renewal",
        planCode: sub.planCode,
        termMonths: sub.termMonths,
        amountCents: amountPaidCents,
        status: "PAID",
        reference: invoiceRef,
        description: `${plan.name} renewal — ${sub.termMonths} month(s)`,
        paidAt: new Date(),
      },
    });
    await tx.auditEvent.create({
      data: {
        actor,
        actorRole: "SYSTEM",
        action: advances ? "subscription.renewed" : "billing.invoice_recorded",
        resource: `subscription:${sub.id}`,
        tenantId: sub.tenantId, tenantName: sub.tenant.name,
        ip: "system",
        detail:
          `Stripe invoice ${invoiceRef} recorded. Paid-through ${renewalAt.toISOString()}; monthly rollover remains independent.`,
      },
    });
  });
}

/** A Stripe charge failed: flip to PAST_DUE and tell the billing contact. */
export async function markPastDue(providerSubscriptionRef: string, invoiceRef: string, failedPeriodEnd?: Date): Promise<void> {
  await serializableTransaction(async (tx) => {
    const sub = await tx.subscription.findFirst({ where: { provider: "stripe", providerRef: providerSubscriptionRef }, include: { tenant: true } });
    if (!sub || sub.status === "PAST_DUE" || sub.status === "CANCELED") return;
    if (await tx.payment.findFirst({ where: { provider: "stripe", reference: invoiceRef, status: "PAID" } })) return;
    if (failedPeriodEnd && failedPeriodEnd <= sub.renewalAt) return;
    await tx.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE", failedPayment: true } });
    await tx.auditEvent.create({
      data: {
        actor: "Docurama Billing",
        actorRole: "SYSTEM",
        action: "subscription.payment_failed",
        resource: `subscription:${sub.id}`,
        tenantId: sub.tenantId, tenantName: sub.tenant.name,
        ip: "system",
        severity: "CRITICAL",
        detail: `Stripe charge failed (${invoiceRef}). Subscription marked PAST_DUE — retry or update the payment method via the billing portal.`,
      },
    });
    const owner = await tx.member.findFirst({
      where: { tenantId: sub.tenantId, role: { in: ["OWNER", "ADMIN"] } },
      include: { user: true },
    });
    if (owner) {
      await tx.mailOutbox.create({
        data: {
          toEmail: owner.user.email,
          subject: `Action needed: payment failed for ${sub.tenant.name}`,
          template: "BILLING",
          bodyText:
            `Our attempt to charge your ${planDef(sub.planCode).name} subscription failed (invoice ${invoiceRef}).\n\n` +
            `Your workspace is now marked past due. Update your payment method from Settings → Billing → Manage payment method, ` +
            `or reply to this email if you believe this is an error. Envelope sending is paused for past-due workspaces after a grace period.`,
        },
      });
    }
  });
}

/** The Stripe subscription ended (portal cancellation, dunning exhausted): mark CANCELED, keep the data. */
export async function markCanceled(providerSubscriptionRef: string): Promise<boolean> {
  const sub = await db.subscription.findFirst({ where: { provider: "stripe", providerRef: providerSubscriptionRef }, include: { tenant: true } });
  if (!sub) return false;
  if (sub.status === "CANCELED") return true;
  await db.subscription.update({ where: { id: sub.id }, data: { status: "CANCELED" } });
  await db.auditEvent.create({
    data: {
      actor: "Docurama Billing",
      actorRole: "SYSTEM",
      action: "subscription.canceled",
      resource: `tenant:${sub.tenant.slug}`,
      tenantId: sub.tenantId, tenantName: sub.tenant.name,
      ip: "system",
      severity: "WARNING",
      detail: "Stripe subscription ended (portal cancellation or exhausted payment retries). The workspace keeps its data; sending stops once the paid term has ended.",
    },
  });
  return true;
}

const RETIRABLE_STATUSES = new Set<string>(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

/**
 * A plan or term change is a fresh Checkout subscription. Once it is active,
 * every other live subscription on the tenant's customer is canceled with a
 * prorated credit (applied by Stripe to the next invoice) — otherwise the old
 * plan would keep charging alongside the new one. Idempotent.
 */
export async function retireSupersededStripeSubscriptions(tenantId: string, keepSubscriptionRef: string): Promise<string[]> {
  const customer = await db.paymentCustomer.findUnique({ where: { tenantId_provider: { tenantId, provider: "stripe" } } });
  if (!customer) return [];
  const stripe = stripeClient();
  const subscriptions = await stripe.subscriptions.list({ customer: customer.externalId, status: "all", limit: 100 });
  const retired: string[] = [];
  for (const subscription of subscriptions.data) {
    if (subscription.id === keepSubscriptionRef || !RETIRABLE_STATUSES.has(subscription.status)) continue;
    // Never-paid subscriptions have nothing to credit back.
    const settled = subscription.status !== "incomplete";
    await stripe.subscriptions.cancel(subscription.id, {
      prorate: settled,
      invoice_now: settled,
      cancellation_details: { comment: `Superseded by ${keepSubscriptionRef} (Docurama plan change)` },
    }, { idempotencyKey: `docurama-retire-${subscription.id}` });
    retired.push(subscription.id);
  }
  if (retired.length) {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });
    await db.auditEvent.create({
      data: {
        actor: "Docurama Billing", actorRole: "SYSTEM", action: "subscription.superseded",
        resource: `tenant:${tenant?.slug ?? tenantId}`, tenantId, tenantName: tenant?.name, ip: "system",
        detail: `Plan change: canceled ${retired.join(", ")} in favour of ${keepSubscriptionRef}; unused time credited to the customer balance.`,
      },
    });
  }
  return retired;
}

/** A checkout that will never be paid: async payment failed, or the session expired. */
export async function closeCheckout(paymentId: string, outcome: "FAILED" | "CANCELED", note: string): Promise<void> {
  const closed = await db.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: outcome, approverNote: note } });
  if (closed.count !== 1 || outcome !== "FAILED") return;
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { tenant: true } });
  await db.auditEvent.create({
    data: {
      actor: "Stripe", actorRole: "SYSTEM", action: "billing.checkout_failed", resource: `tenant:${payment.tenant.slug}`,
      tenantId: payment.tenantId, tenantName: payment.tenant.name, ip: "system", severity: "WARNING",
      detail: `${payment.description}: ${note}`,
    },
  });
  const owner = await db.member.findFirst({ where: { tenantId: payment.tenantId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, include: { user: true } });
  if (owner) {
    await db.mailOutbox.create({
      data: {
        toEmail: owner.user.email,
        subject: `Payment not completed for ${payment.tenant.name}`,
        template: "BILLING",
        bodyText:
          `The payment for "${payment.description}" could not be completed (${note}).\n\n` +
          `Your plan has not changed. You can try again with another payment method from Settings → Billing.`,
      },
    });
  }
}

/** Portal cancellation scheduled or reverted: audit the churn signal for admins. */
export async function recordSubscriptionUpdate(subscription: Stripe.Subscription, previous: Record<string, unknown> | undefined): Promise<boolean> {
  const sub = await db.subscription.findFirst({ where: { provider: "stripe", providerRef: subscription.id }, include: { tenant: true } });
  if (!sub) return false;
  if (!previous || !("cancel_at_period_end" in previous || "cancel_at" in previous)) return true;
  const scheduled = subscription.cancel_at_period_end || Boolean(subscription.cancel_at);
  await db.auditEvent.create({
    data: {
      actor: "Stripe", actorRole: "SYSTEM",
      action: scheduled ? "subscription.cancel_scheduled" : "subscription.cancel_reverted",
      resource: `subscription:${sub.id}`, tenantId: sub.tenantId, tenantName: sub.tenant.name, ip: "system",
      severity: scheduled ? "WARNING" : "INFO",
      detail: scheduled
        ? `Cancellation scheduled from the customer portal; service continues until ${sub.renewalAt.toISOString().slice(0, 10)}.`
        : "Scheduled cancellation reverted from the customer portal.",
    },
  });
  return true;
}

async function tenantForStripeCustomer(customer: string | { id: string } | null | undefined) {
  const externalId = typeof customer === "string" ? customer : customer?.id;
  if (!externalId) return null;
  const mapping = await db.paymentCustomer.findFirst({ where: { provider: "stripe", externalId }, include: { tenant: true } });
  return mapping?.tenant ?? null;
}

/** True when a Stripe customer id belongs to a Docurama workspace. */
export async function isDocuramaCustomer(customer: string | { id: string } | null | undefined): Promise<boolean> {
  return (await tenantForStripeCustomer(customer)) !== null;
}

/**
 * Refunds issued from the Stripe dashboard land in the ledger (one REFUNDED
 * row per refunded increment). A refund never changes the plan by itself —
 * cancel the subscription in Stripe as well when service should stop.
 */
export async function recordRefund(charge: Stripe.Charge): Promise<boolean> {
  const tenant = await tenantForStripeCustomer(charge.customer);
  if (!tenant) return false;
  const reference = `refund:${charge.id}:${charge.amount_refunded}`;
  await serializableTransaction(async (tx) => {
    if (await tx.payment.findFirst({ where: { provider: "stripe", reference } })) return;
    const earlier = await tx.payment.findMany({ where: { provider: "stripe", kind: "refund", reference: { startsWith: `refund:${charge.id}:` } } });
    const delta = charge.amount_refunded - earlier.reduce((sum, row) => sum + row.amountCents, 0);
    if (delta <= 0) return;
    const sub = await tx.subscription.findFirst({ where: { tenantId: tenant.id }, orderBy: { renewalAt: "desc" } });
    await tx.payment.create({
      data: {
        tenantId: tenant.id, provider: "stripe", kind: "refund", planCode: sub?.planCode ?? tenant.planCode,
        termMonths: sub?.termMonths ?? 1, amountCents: delta, currency: charge.currency.toUpperCase(), status: "REFUNDED",
        reference, description: `Refund of ${centsToEur(delta)} on charge ${charge.id}`, paidAt: new Date(),
      },
    });
    await tx.auditEvent.create({
      data: {
        actor: "Stripe", actorRole: "SYSTEM", action: "billing.refunded", resource: `tenant:${tenant.slug}`,
        tenantId: tenant.id, tenantName: tenant.name, ip: "system", severity: "WARNING",
        detail: `${centsToEur(delta)} refunded on ${charge.id} (total refunded ${centsToEur(charge.amount_refunded)}). The plan is unchanged unless the subscription is canceled.`,
      },
    });
  });
  return true;
}

/** A chargeback: CRITICAL audit so the billing team responds before the evidence deadline. */
export async function recordDispute(dispute: Stripe.Dispute, charge: Stripe.Charge): Promise<boolean> {
  const tenant = await tenantForStripeCustomer(charge.customer);
  if (!tenant) return false;
  const already = await db.auditEvent.findFirst({ where: { action: "billing.dispute_opened", resource: `dispute:${dispute.id}` } });
  if (already) return true;
  const due = dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000).toISOString().slice(0, 10) : "see Stripe";
  await db.auditEvent.create({
    data: {
      actor: "Stripe", actorRole: "SYSTEM", action: "billing.dispute_opened", resource: `dispute:${dispute.id}`,
      tenantId: tenant.id, tenantName: tenant.name, ip: "system", severity: "CRITICAL",
      detail: `Chargeback of ${centsToEur(dispute.amount)} (${dispute.reason}) on ${charge.id}. Submit evidence in the Stripe dashboard by ${due}.`,
    },
  });
  return true;
}

// ─── Receipts ────────────────────────────────────────────────────────────────

async function queueReceiptMail(tenantId: string, planName: string, months: number, amountCents: number, renewalAt: Date, client: Prisma.TransactionClient = db) {
  const owner = await client.member.findFirst({ where: { tenantId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, include: { user: true } });
  if (!owner) return;
  await client.mailOutbox.create({
    data: {
      toEmail: owner.user.email,
      subject: `Receipt: ${planName} activated — ${centsToEur(amountCents)}`,
      template: "BILLING",
      bodyText:
        `Your ${planName} plan is active for ${months} month(s). Amount charged: ${centsToEur(amountCents)}.\n\n` +
        `Next renewal: ${renewalAt.toISOString().slice(0, 10)}. Unused envelopes roll over on renewal (up to one monthly allowance).\n` +
        `Manage payment methods and invoices any time from Settings → Billing.`,
    },
  });
}

// ─── Portal ──────────────────────────────────────────────────────────────────

export async function createPortalSession(tenantId: string, origin: string): Promise<{ url: string } | { error: string }> {
  const customer = await db.paymentCustomer.findUnique({ where: { tenantId_provider: { tenantId, provider: "stripe" } } });
  if (!customer) return { error: "No Stripe customer on file yet — start a checkout first." };
  const stripe = stripeClient();
  if (!(await retrieveCustomer(stripe, customer.externalId))) return { error: "No Stripe customer on file yet — start a checkout first." };
  const session = await stripe.billingPortal.sessions.create({
    customer: customer.externalId,
    configuration: await ensurePortalConfiguration(stripe, origin),
    return_url: `${origin}/settings/billing`,
  });
  return { url: session.url };
}
