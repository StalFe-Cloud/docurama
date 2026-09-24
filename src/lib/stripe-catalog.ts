import type Stripe from "stripe";
import { planDef, termCents, termFor } from "@/lib/plans";

/**
 * Stripe catalog + portal provisioning (go-live cycle).
 *
 * Checkout references real Products/Prices instead of inline price_data:
 * inline product_data minted a new Product on every checkout, cluttering the
 * catalog and making revenue reporting per plan impossible.
 *
 *   Product  docurama_<plan>            fixed id, one per plan
 *   Price    lookup_key docurama_<plan>_<n>m   one per plan × term
 *
 * Everything is ensured lazily and idempotently, so a fresh Stripe account
 * (test or live) needs no manual catalog work; `scripts/stripe-setup.ts`
 * pre-provisions the same objects ahead of launch. When src/lib/plans.ts
 * changes a price, the next checkout mints a new Price, moves the lookup key
 * to it and archives the old one. Existing subscriptions keep the price they
 * bought (grandfathered, never silently repriced).
 *
 * The Stripe account can be shared with other products, so every object
 * Docurama creates carries metadata.app = "docurama" and the webhook ignores
 * events whose objects lack it.
 */

export const STRIPE_APP = "docurama";

/** Pinned API version: the SDK client and the webhook endpoint must agree. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

/** Events POST /api/billing/webhook handles — register exactly these. */
export const STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded",
  "charge.dispute.created",
] as const;

/** Stripe Tax product code: Software as a service (SaaS), business use. */
export const STRIPE_SAAS_TAX_CODE = "txcd_10103001";

export function isDocuramaMetadata(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadata?.app === STRIPE_APP;
}

export function stripeProductId(planCode: string): string {
  return `docurama_${planDef(planCode).code.toLowerCase()}`;
}

export function stripePriceLookupKey(planCode: string, termMonths: number): string {
  return `docurama_${planDef(planCode).code.toLowerCase()}_${termFor(termMonths).months}m`;
}

/** Catalog prices are VAT-exclusive (B2B default) unless STRIPE_TAX_BEHAVIOR=inclusive. */
export function stripeTaxBehavior(): "exclusive" | "inclusive" {
  return process.env.STRIPE_TAX_BEHAVIOR === "inclusive" ? "inclusive" : "exclusive";
}

/** Stripe Tax on Checkout. Requires Stripe Tax to be activated on the account first. */
export function stripeAutomaticTax(): boolean {
  return ["1", "true"].includes(String(process.env.STRIPE_AUTOMATIC_TAX ?? "").toLowerCase());
}

const priceCache = new Map<string, string>();
let portalConfigurationId: string | null = null;

/** Test seam: forget ids resolved against another account or stub. */
export function resetStripeCatalogCache(): void {
  priceCache.clear();
  portalConfigurationId = null;
}

function stripeErrorCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

async function ensureProduct(stripe: Stripe, planCode: string): Promise<string> {
  const plan = planDef(planCode);
  const id = stripeProductId(plan.code);
  try {
    const product = await stripe.products.retrieve(id);
    if (!product.active) await stripe.products.update(id, { active: true });
    return id;
  } catch (err) {
    if (stripeErrorCode(err) !== "resource_missing") throw err;
  }
  try {
    await stripe.products.create({
      id,
      name: `Docurama ${plan.name}`,
      description: plan.bestFor,
      tax_code: STRIPE_SAAS_TAX_CODE,
      // Subscription charges show this on card/bank statements instead of the
      // (possibly shared) account's name — fewer "unknown charge" disputes.
      statement_descriptor: "DOCURAMA",
      metadata: { app: STRIPE_APP, planCode: plan.code },
    });
  } catch (err) {
    // A concurrent checkout created the fixed id first.
    if (stripeErrorCode(err) !== "resource_already_exists") throw err;
  }
  return id;
}

/** Resolve (or mint) the recurring EUR Price for a plan × term; returns its id. */
export async function ensurePlanPrice(stripe: Stripe, planCode: string, termMonths: number): Promise<string> {
  const plan = planDef(planCode);
  const term = termFor(termMonths);
  const lookupKey = stripePriceLookupKey(plan.code, term.months);
  const amount = termCents(plan.code, term.months);
  const taxBehavior = stripeTaxBehavior();
  const cacheKey = `${lookupKey}:${amount}:${taxBehavior}`;
  const cached = priceCache.get(cacheKey);
  if (cached) return cached;

  const current = (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0];
  if (current && current.unit_amount === amount && current.currency === "eur" && current.tax_behavior === taxBehavior &&
      current.recurring?.interval === "month" && current.recurring.interval_count === term.months) {
    priceCache.set(cacheKey, current.id);
    return current.id;
  }

  const product = await ensureProduct(stripe, plan.code);
  const price = await stripe.prices.create({
    product,
    currency: "eur",
    unit_amount: amount,
    tax_behavior: taxBehavior,
    recurring: { interval: "month", interval_count: term.months },
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    nickname: `${plan.name} — ${term.label}${term.discountPct ? ` (−${term.discountPct}%)` : ""}`,
    metadata: { app: STRIPE_APP, planCode: plan.code, termMonths: String(term.months) },
  }, { idempotencyKey: `docurama-price-${lookupKey}-${amount}-${taxBehavior}` });
  // An idempotent replay can hand back a price an operator archived since.
  if (!price.active) await stripe.prices.update(price.id, { active: true });
  // Archive the superseded catalog price; subscriptions already on it keep it.
  if (current && current.id !== price.id) await stripe.prices.update(current.id, { active: false });
  priceCache.set(cacheKey, price.id);
  return price.id;
}

/**
 * The Docurama customer-portal configuration: payment method, billing
 * details, tax id and invoice history, cancellation at period end. Plan
 * changes go through Checkout, never the portal. Found by metadata so the
 * account's default configuration (possibly another product's) is untouched.
 */
export async function ensurePortalConfiguration(stripe: Stripe, origin: string): Promise<string> {
  if (portalConfigurationId) return portalConfigurationId;
  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const found = existing.data.find((configuration) => isDocuramaMetadata(configuration.metadata));
  if (found) {
    portalConfigurationId = found.id;
    return found.id;
  }
  // Stripe rejects non-public policy links; local origins simply omit them.
  const publicOrigin = origin.startsWith("https://") ? origin : null;
  const created = await stripe.billingPortal.configurations.create({
    business_profile: {
      // Stripe caps the headline at 60 characters.
      headline: "Docurama — payment method, billing details and invoices",
      ...(publicOrigin ? { privacy_policy_url: `${publicOrigin}/privacy`, terms_of_service_url: `${publicOrigin}/terms` } : {}),
    },
    ...(publicOrigin ? { default_return_url: `${publicOrigin}/settings/billing` } : {}),
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "name", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] },
      },
    },
    metadata: { app: STRIPE_APP },
  }, { idempotencyKey: `docurama-portal-configuration-${publicOrigin ?? "local"}` });
  portalConfigurationId = created.id;
  return created.id;
}
