/**
 * Provision Docurama's Stripe objects ahead of launch. Idempotent — safe to
 * re-run after every pricing change and on every environment (test or live).
 *
 *   STRIPE_SECRET_KEY=rk_live_… bun scripts/stripe-setup.ts \
 *     --origin https://app.docurama.eu \
 *     --webhook-url https://app.docurama.eu/api/billing/webhook
 *
 * Creates or reuses, all tagged metadata.app=docurama so an account shared
 * with other products is never touched outside Docurama's objects:
 *   - one Product per self-serve plan and one Price per plan × term
 *     (lookup keys docurama_<plan>_<n>m, VAT behaviour from STRIPE_TAX_BEHAVIOR);
 *   - the Docurama customer-portal configuration;
 *   - with --webhook-url: the webhook endpoint with exactly the handled events.
 *     A NEW endpoint's signing secret is printed once — put it in
 *     STRIPE_WEBHOOK_SECRET. An existing endpoint is updated in place; its
 *     secret stays in the dashboard (Developers → Webhooks → Reveal).
 */
import Stripe from "stripe";
import { BILLING_TERMS, SELF_SERVE_PLANS, planDef, termCents } from "../src/lib/plans";
import {
  STRIPE_API_VERSION, STRIPE_APP, STRIPE_WEBHOOK_EVENTS,
  ensurePlanPrice, ensurePortalConfiguration, stripePriceLookupKey, stripeTaxBehavior,
} from "../src/lib/stripe-catalog";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is required (use a test key first).");
  process.exit(1);
}
const origin = (arg("origin") ?? "https://app.docurama.eu").replace(/\/+$/, "");
const webhookUrl = arg("webhook-url");
if (!origin.startsWith("https://")) {
  console.error("--origin must be the public https origin customers use (portal policy links point there).");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion, maxNetworkRetries: 2 });
const mode = /^(sk|rk)_live_/.test(key) ? "LIVE" : "test";
console.log(`Stripe ${mode} mode · prices ${stripeTaxBehavior()} of VAT · origin ${origin}\n`);

console.log("Catalog");
for (const planCode of SELF_SERVE_PLANS) {
  for (const term of BILLING_TERMS) {
    const price = await ensurePlanPrice(stripe, planCode, term.months);
    const eur = (termCents(planCode, term.months) / 100).toFixed(2);
    console.log(`  ${stripePriceLookupKey(planCode, term.months).padEnd(24)} ${price}  €${eur} every ${term.months} month(s) — ${planDef(planCode).name}`);
  }
}

const portal = await ensurePortalConfiguration(stripe, origin);
console.log(`\nCustomer portal configuration  ${portal}`);

if (webhookUrl) {
  const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find((endpoint) => endpoint.url === webhookUrl);
  const enabled_events = [...STRIPE_WEBHOOK_EVENTS] as Stripe.WebhookEndpointCreateParams.EnabledEvent[];
  if (existing) {
    await stripe.webhookEndpoints.update(existing.id, { enabled_events, disabled: false, metadata: { app: STRIPE_APP } });
    console.log(`\nWebhook endpoint ${existing.id} updated (${enabled_events.length} events).`);
    if (existing.api_version && existing.api_version !== STRIPE_API_VERSION) {
      console.warn(`  ! endpoint API version ${existing.api_version} differs from ${STRIPE_API_VERSION}; recreate it to pin the version.`);
    }
    console.log("  Signing secret: dashboard → Developers → Webhooks → this endpoint → Reveal.");
  } else {
    const created = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events,
      api_version: STRIPE_API_VERSION as Stripe.WebhookEndpointCreateParams.ApiVersion,
      description: "Docurama billing",
      metadata: { app: STRIPE_APP },
    });
    console.log(`\nWebhook endpoint ${created.id} created (${enabled_events.length} events).`);
    console.log(`  STRIPE_WEBHOOK_SECRET=${created.secret}`);
    console.log("  Shown once: store it in the deployment .env now.");
  }
} else {
  console.log("\n(no --webhook-url: webhook endpoint not checked)");
}
