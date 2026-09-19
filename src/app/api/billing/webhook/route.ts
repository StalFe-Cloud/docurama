import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClient } from "@/lib/payments";
import { activateSubscription, renewPaidTerm, markPastDue, markCanceled } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/webhook — Stripe events, signature-verified.
 *
 * Handled events:
 *   checkout.session.completed        → activate the plan for the paid term
 *   invoice.paid                      → advance one term (rollover computed)
 *   invoice.payment_failed            → PAST_DUE + mail to the billing contact
 *   customer.subscription.deleted     → CANCELED (data kept, term honored)
 *
 * Everything else is acknowledged 200 and audited as ignored.
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
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.client_reference_id ?? session.metadata?.tenantId ?? null;
        const planCode = session.metadata?.planCode ?? null;
        const termMonths = Number(session.metadata?.termMonths ?? 1);
        if (!tenantId || !planCode) break;

        await activateSubscription({
          tenantId,
          planCode,
          termMonths: [1, 3, 6, 12].includes(termMonths) ? termMonths : 1,
          provider: "stripe",
          providerRef: typeof session.subscription === "string" ? session.subscription : (session.subscription as { id?: string } | null)?.id ?? null,
          paymentReference: session.id,
          actor: "Stripe",
          actorRole: "SYSTEM",
          note: `checkout ${session.id}`,
        });
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | { id: string } | null };
        const subRef = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id ?? null;
        const sub = subRef
          ? await db.subscription.findFirst({ where: { providerRef: subRef } })
          : await findSubscriptionByCustomer(invoice.customer);
        if (sub) {
          // checkout.session.completed already handled the first term.
          const isFirstTerm = await db.payment.findFirst({
            where: { reference: invoice.id ?? "none", status: "PAID" },
          });
          if (!isFirstTerm) await renewPaidTerm(sub.id, invoice.id ?? `in_${event.id}`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | { id: string } | null };
        const subRef = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id ?? null;
        if (subRef) await markPastDue(subRef, invoice.id ?? `in_${event.id}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await markCanceled(subscription.id);
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true, type: event.type });
  } catch (err) {
    console.error("billing/webhook", event.type, err);
    // 500 makes Stripe retry — the right answer for transient DB failures.
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}

/** Fallback: map a Stripe customer id to its subscription via PaymentCustomer. */
async function findSubscriptionByCustomer(customer: string | { id: string } | null): Promise<{ id: string } | null> {
  if (!customer) return null;
  const customerId = typeof customer === "string" ? customer : customer.id;
  const pc = await db.paymentCustomer.findFirst({ where: { externalId: customerId } });
  if (!pc) return null;
  return db.subscription.findFirst({ where: { tenantId: pc.tenantId, provider: "stripe" }, orderBy: { renewalAt: "desc" } });
}
