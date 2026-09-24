import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import type { Payment } from "@prisma/client";
import { db } from "@/lib/db";
import {
  stripeClient, activateSubscription, renewPaidTerm, markPastDue, markCanceled, closeCheckout,
  retireSupersededStripeSubscriptions, recordSubscriptionUpdate, recordRefund, recordDispute, isDocuramaCustomer,
} from "@/lib/payments";
import { isDocuramaMetadata } from "@/lib/stripe-catalog";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/webhook — Stripe events, signature-verified.
 *
 * Handled events:
 *   checkout.session.completed               → activate only once payment is paid
 *   checkout.session.async_payment_succeeded → activate a delayed (SEPA) paid checkout
 *   checkout.session.async_payment_failed    → checkout FAILED + mail to the billing contact
 *   checkout.session.expired                 → abandoned checkout CANCELED
 *   invoice.paid                             → apply the paid recurring service period
 *   invoice.payment_failed                   → PAST_DUE + mail to the billing contact
 *   customer.subscription.updated            → audit portal cancellation scheduled/reverted
 *   customer.subscription.deleted            → CANCELED (data kept, term honored)
 *   charge.refunded                          → REFUNDED ledger row
 *   charge.dispute.created                   → CRITICAL audit (chargeback)
 *
 * The Stripe account may be shared with other products. Each handler first
 * proves the object is Docurama's (metadata.app, or a local payment, customer
 * or subscription row) and acknowledges foreign events 200 without acting: a
 * 5xx for another product's event would be retried for days until Stripe
 * disables this endpoint.
 *
 * Initial invoices are owned by checkout activation. Payment claims,
 * entitlements, audit and receipt records commit together so retries cannot
 * grant duplicate terms.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhooks not configured on this instance" }, { status: 400 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  // Raw body is required for signature verification — read before any JSON parse.
  const raw = await req.text();
  const stripe = stripeClient();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch (err) {
    await db.auditEvent.create({
      data: {
        actor: "Stripe",
        actorRole: "SYSTEM",
        action: "billing.webhook_rejected",
        resource: "billing",
        ip: "system",
        severity: "WARNING",
        detail: `Signature verification failed: ${err instanceof Error ? err.message : "unknown error"}`,
      },
    }).catch(() => undefined);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const handled = await handleEvent(stripe, event);
    return NextResponse.json({ received: true, type: event.type, handled });
  } catch (err) {
    console.error("billing/webhook", event.type, err);
    // 500 makes Stripe retry — the right answer for transient DB failures.
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}

/** Returns whether the event concerned Docurama (false = acknowledged, ignored). */
async function handleEvent(stripe: Stripe, event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      const recorded = await checkoutPayment(session);
      if (!recorded) {
        if (isDocuramaMetadata(session.metadata)) throw new Error("Checkout payment has not been recorded yet");
        return false;
      }
      // A completed checkout can still be awaiting an asynchronous payment.
      if (session.payment_status !== "paid") return true;
      const tenantId = session.client_reference_id ?? session.metadata?.tenantId ?? null;
      const planCode = session.metadata?.planCode ?? null;
      const termMonths = Number(session.metadata?.termMonths ?? 1);
      if (!tenantId || !planCode) throw new Error("Checkout identity metadata is missing");
      const subscriptionRef = objectId(session.subscription);
      if (!subscriptionRef) throw new Error("Paid checkout has no subscription");

      if (recorded.status !== "PAID") {
        const providerSubscription = await stripe.subscriptions.retrieve(subscriptionRef);
        if (providerSubscription.status === "canceled") return true;
        await activateSubscription({
          tenantId,
          planCode,
          termMonths: [1, 3, 6, 12].includes(termMonths) ? termMonths : 1,
          provider: "stripe",
          providerRef: subscriptionRef,
          providerPeriodEnd: subscriptionPeriodEnd(providerSubscription),
          amountPaidCents: session.currency === "eur" ? session.amount_total : null,
          paymentId: recorded.id,
          actor: "Stripe",
          actorRole: "SYSTEM",
          note: `checkout ${session.id}`,
        });
      }
      // Replace, never stack: retire the previous plan's subscription. Also on
      // replays (so a failed cancellation is retried with the event), but only
      // while this checkout's subscription is still the tenant's current one.
      const current = await db.subscription.findFirst({ where: { tenantId, provider: "stripe", providerRef: subscriptionRef } });
      if (current && current.status !== "CANCELED") await retireSupersededStripeSubscriptions(tenantId, subscriptionRef);
      return true;
    }

    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const recorded = await checkoutPayment(session);
      if (!recorded) return false;
      if (event.type === "checkout.session.expired") {
        await closeCheckout(recorded.id, "CANCELED", "Checkout expired before payment");
      } else {
        await closeCheckout(recorded.id, "FAILED", "the delayed bank payment was declined");
      }
      return true;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      // Checkout owns the initial paid term. One-off invoices, prorations and
      // subscription creation must not add another whole term.
      if (invoice.billing_reason !== "subscription_cycle") return false;
      const subRef = invoiceSubscriptionRef(invoice);
      if (!subRef) return false;
      const sub = await db.subscription.findFirst({ where: { provider: "stripe", providerRef: subRef } });
      if (!sub) {
        if (!(await ownsInvoice(invoice))) return false;
        // Ours but not active locally: either its activation is still in
        // flight (retry) or it was superseded by a plan change (nothing to do).
        const providerSubscription = await stripe.subscriptions.retrieve(subRef);
        if (providerSubscription.status === "canceled" || providerSubscription.status === "incomplete_expired") return true;
        throw new Error("Renewal arrived before its subscription activation");
      }
      await renewPaidTerm(sub.id, invoice.id, invoicePeriodEnd(invoice), invoice.amount_paid);
      return true;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subRef = invoiceSubscriptionRef(invoice);
      if (!subRef) return false;
      // Prove ownership before parsing: another product's invoice shape must never 500.
      if (!(await db.subscription.findFirst({ where: { provider: "stripe", providerRef: subRef }, select: { id: true } }))) return false;
      await markPastDue(subRef, invoice.id, invoicePeriodEnd(invoice));
      return true;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      return recordSubscriptionUpdate(subscription, event.data.previous_attributes as Record<string, unknown> | undefined);
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      return markCanceled(subscription.id);
    }

    case "charge.refunded":
      return recordRefund(event.data.object as Stripe.Charge);

    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeRef = objectId(dispute.charge);
      if (!chargeRef) return false;
      return recordDispute(dispute, await stripe.charges.retrieve(chargeRef));
    }

    default:
      return false;
  }
}

/** The local checkout row a session belongs to, or null when it is not Docurama's. */
async function checkoutPayment(session: Stripe.Checkout.Session): Promise<Payment | null> {
  const paymentId = session.metadata?.paymentId;
  if (paymentId) {
    const byId = await db.payment.findUnique({ where: { id: paymentId } });
    if (byId && byId.provider === "stripe" && byId.kind === "checkout" && (!byId.reference || byId.reference === session.id)) {
      if (!byId.reference) return db.payment.update({ where: { id: byId.id }, data: { reference: session.id } });
      return byId;
    }
  }
  return db.payment.findFirst({ where: { provider: "stripe", kind: "checkout", reference: session.id } });
}

async function ownsInvoice(invoice: Stripe.Invoice): Promise<boolean> {
  return isDocuramaMetadata(invoice.parent?.subscription_details?.metadata) || isDocuramaCustomer(invoice.customer);
}

function objectId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function invoiceSubscriptionRef(invoice: Stripe.Invoice): string | null {
  // Current Stripe API nests the subscription under parent; older webhook
  // endpoints can still deliver the former top-level property.
  return objectId(invoice.parent?.subscription_details?.subscription) ??
    objectId((invoice as Stripe.Invoice & { subscription?: string | { id: string } }).subscription);
}

function validPeriodEnd(seconds: number | undefined): Date {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) throw new Error("Stripe service period is missing");
  return new Date(seconds * 1000);
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription): Date {
  // Docurama checkout creates exactly one recurring plan item. Use Stripe's
  // dates so retries or late events cannot shift the purchased service term.
  const items = subscription.items?.data ?? [];
  if (items.length > 1) throw new Error("Subscription must contain one recurring plan item");
  return validPeriodEnd(items[0]?.current_period_end ??
    (subscription as Stripe.Subscription & { current_period_end?: number }).current_period_end);
}

function invoicePeriodEnd(invoice: Stripe.Invoice): Date {
  const subscriptionLines = (invoice.lines?.data ?? []).filter((line) =>
    line.parent?.type === "subscription_item_details" ||
    (line as typeof line & { type?: string }).type === "subscription",
  );
  if (subscriptionLines.length !== 1) throw new Error("Invoice must identify one recurring plan service period");
  return validPeriodEnd(subscriptionLines[0].period?.end);
}
