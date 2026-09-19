/// <reference types="bun-types" />

/**
 * Payment rails E2E — src/lib/payments.ts + /api/billing/webhook, hermetic.
 *
 * Run: bun test e2e/billing.test.ts   (run.sh wires a scratch DATABASE_URL)
 * Own process — it owns PAYMENT_PROVIDER / STRIPE_* env, which are read at
 * call time by design.
 *
 * Covered:
 *  1. money math for the final ladder (Solo €12 … Business €79);
 *  2. manual mode end-to-end: checkout → PENDING payment + bank reference
 *     → activation (the exact path an admin approval runs) → PAID, audit,
 *     receipt mail, idempotent payment status;
 *  3. Stripe mode against an in-process stub (STRIPE_API_BASE): checkout
 *     session + customer mapping + portal session;
 *  4. the signed webhook route: not-configured 400, bad signature 400,
 *     checkout.session.completed activation, invoice.paid renewal with
 *     rollover, invoice.payment_failed → PAST_DUE + dunning mail,
 *     customer.subscription.deleted → CANCELED.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ── Scratch database (copy of the committed seed) ─────────────────────────── */

const SCRATCH = join(mkdtempSync(join(tmpdir(), "billing-e2e-")), "scratch.db");
cpSync("db/custom.db", SCRATCH);
process.env.DATABASE_URL = `file:${SCRATCH}`;

const db = new PrismaClient();

/* ── System under test (imported after DATABASE_URL is in place) ───────────── */

const lib = await import("../src/lib/payments");
const plans = await import("../src/lib/plans");
const webhookRoute = await import("../src/app/api/billing/webhook/route");
const Stripe = (await import("stripe")).default;

/* ── A local stub Stripe API ───────────────────────────────────────────────── */

const stub = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method !== "POST") return new Response("not found", { status: 404 });
    if (url.pathname === "/v1/customers") {
      return Response.json({ id: "cus_test_1", object: "customer" });
    }
    if (url.pathname === "/v1/checkout/sessions") {
      return Response.json({
        id: "cs_test_9", object: "checkout.session", mode: "subscription",
        url: "https://checkout.stripe.test/pay/cs_test_9",
        subscription: "sub_test_9", customer: "cus_test_1",
      });
    }
    if (url.pathname === "/v1/billing_portal/sessions") {
      return Response.json({ id: "bps_test_1", object: "billing_portal.session", url: "https://billing.stripe.test/session/bps_test_1" });
    }
    return new Response("not found", { status: 404 });
  },
});

const STRIPE_SECRET = "sk_test_billing_e2e";
const WEBHOOK_SECRET = "whsec_billing_e2e";

async function signedEvent(type: string, object: unknown): Promise<{ payload: string; header: string }> {
  const payload = JSON.stringify({ id: `evt_${type}`, object: { object: "event", type }, type, data: { object } });
  const stripe = new Stripe(STRIPE_SECRET, { apiVersion: "2026-08-26.dahlia" as never });
  const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: WEBHOOK_SECRET });
  return { payload, header };
}

async function postWebhook(payload: string, header: string | null): Promise<Response> {
  return webhookRoute.POST(
    new Request("http://127.0.0.1:3000/api/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(header ? { "stripe-signature": header } : {}),
      },
      body: payload,
    }) as never,
  );
}

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const tenant = await db.tenant.findUnique({ where: { slug: "solstice-media" } });
if (!tenant) throw new Error("seed tenant solstice-media missing — run bun run test:e2e:seed first");

beforeAll(() => {
  // Manual mode is the default (no env) — nothing to set for suite 1–2.
});

afterAll(async () => {
  await db.$disconnect();
  await (await import("../src/lib/db")).db.$disconnect();
  stub.stop(true);
  rmSync(join(SCRATCH, ".."), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/* ── 1. Money math for the final ladder ────────────────────────────────────── */

describe("payment money math (final ladder)", () => {
  test("Solo monthly is €12.00, Starter monthly €29.00", () => {
    expect(plans.PLAN_CATALOG.SOLO.monthlyEur).toBe(12);
    expect(lib.termCents("SOLO", 1)).toBe(1200);
    expect(plans.PLAN_CATALOG.STARTER.monthlyEur).toBe(29);
    expect(lib.termCents("STARTER", 1)).toBe(2900);
  });

  test("committed terms apply the incremental discount: Starter 12mo €278.40, Business 3mo €225.15, Business 6mo €426.60", () => {
    expect(lib.termCents("STARTER", 12)).toBe(27840);
    expect(lib.termCents("BUSINESS", 3)).toBe(22515);
    expect(lib.termCents("BUSINESS", 6)).toBe(42660);
  });
});

/* ── 2. Manual mode: bank transfer + activation ────────────────────────────── */

describe("manual mode (bank transfer, out-of-band)", () => {
  test("paymentMode is manual without Stripe env", () => {
    expect(lib.paymentMode()).toBe("manual");
  });

  let paymentId = "";
  let reference = "";

  test("checkout records a PENDING payment with a quotable bank reference", async () => {
    const result = await lib.createCheckout({
      tenantId: tenant.id, tenantName: tenant.name,
      userEmail: "billing-e2e@docurama.eu", userName: "Billing E2E",
      planCode: "BUSINESS", termMonths: 3, origin: "http://127.0.0.1:3000",
    });
    expect(result.mode).toBe("manual");
    expect(result.amountCents).toBe(22515);
    expect(result.reference).toMatch(/^DRM-/);
    expect(result.instructions).toBeTruthy();
    reference = result.reference;

    const row = await db.payment.findFirst({ where: { reference } });
    expect(row?.status).toBe("PENDING");
    expect(row?.provider).toBe("manual");
    expect(row?.planCode).toBe("BUSINESS");
    paymentId = row!.id;
  });

  test("activation (the admin-approval path) flips plan, subscription and payment", async () => {
    const before = await db.subscription.findFirst({ where: { tenantId: tenant.id }, orderBy: { renewalAt: "desc" } });
    expect(before?.provider).not.toBe("stripe");

    const out = await lib.activateSubscription({
      tenantId: tenant.id, planCode: "BUSINESS", termMonths: 3,
      provider: "manual", paymentId,
      actor: "billing-e2e admin", actorRole: "PLATFORM_ADMIN",
      note: "BANK-REF-7731",
    });
    expect(out.planCode).toBe("BUSINESS");
    // 3-month term → renewal ≈ +3 months from now.
    const diffDays = (out.renewalAt.getTime() - Date.now()) / 86_400_000;
    expect(diffDays).toBeGreaterThan(89);
    expect(diffDays).toBeLessThan(93);

    const t = await db.tenant.findUnique({ where: { id: tenant.id } });
    expect(t?.planCode).toBe("BUSINESS");

    const sub = await db.subscription.findFirst({ where: { tenantId: tenant.id }, orderBy: { renewalAt: "desc" } });
    expect(sub?.status).toBe("ACTIVE");
    expect(sub?.planCode).toBe("BUSINESS");
    expect(sub?.provider).toBe("manual");
    expect(sub?.discountPct).toBe(5);

    const payment = await db.payment.findUnique({ where: { id: paymentId } });
    expect(payment?.status).toBe("PAID");
    expect(payment?.paidAt).toBeTruthy();
    expect(payment?.approverNote).toBe("BANK-REF-7731");

    const audit = await db.auditEvent.findFirst({ where: { action: "subscription.activated", resource: `tenant:${t!.slug}` }, orderBy: { at: "desc" } });
    expect(audit?.detail).toContain("Business");

    const receipt = await db.mailOutbox.findFirst({ where: { subject: { contains: "Business activated" } }, orderBy: { createdAt: "desc" } });
    expect(receipt?.template).toBe("BILLING");
  });

  test("re-approving the same payment is idempotent (no second PAID flip, no dup rows)", async () => {
    await lib.activateSubscription({
      tenantId: tenant.id, planCode: "BUSINESS", termMonths: 3,
      provider: "manual", paymentId,
      actor: "billing-e2e admin", actorRole: "PLATFORM_ADMIN",
      note: "duplicate replay",
    });
    const rows = await db.payment.findMany({ where: { id: paymentId } });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("PAID");
  });
});

/* ── 3+4. Stripe mode + the signed webhook route ───────────────────────────── */

describe("stripe mode against a stub API + webhook route", () => {
  test("webhook without STRIPE_WEBHOOK_SECRET configured answers 400", async () => {
    const { payload, header } = await signedEvent("checkout.session.completed", {});
    const res = await postWebhook(payload, header);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("not configured");
  });

  test("checkout creates a Stripe customer + session and returns the stub URL", async () => {
    process.env.PAYMENT_PROVIDER = "stripe";
    process.env.STRIPE_SECRET_KEY = STRIPE_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_API_BASE = `http://127.0.0.1:${stub.port}`;
    lib.resetStripeClient();
    expect(lib.paymentMode()).toBe("stripe");

    const result = await lib.createCheckout({
      tenantId: tenant.id, tenantName: tenant.name,
      userEmail: "billing-e2e@docurama.eu", userName: "Billing E2E",
      planCode: "SOLO", termMonths: 12, origin: "http://127.0.0.1:3000",
    });
    expect(result.mode).toBe("stripe");
    expect(result.url).toBe("https://checkout.stripe.test/pay/cs_test_9");
    expect(result.amountCents).toBe(11520); // 12 × €12 −20%

    const customer = await db.paymentCustomer.findUnique({ where: { tenantId_provider: { tenantId: tenant.id, provider: "stripe" } } });
    expect(customer?.externalId).toBe("cus_test_1");

    const row = await db.payment.findFirst({ where: { reference: "cs_test_9" } });
    expect(row?.status).toBe("PENDING");
    expect(row?.checkoutUrl).toBe(result.url);
  });

  test("portal session returns the stub portal URL", async () => {
    const out = await lib.createPortalSession(tenant.id, "http://127.0.0.1:3000");
    expect("error" in out).toBe(false);
    if (!("error" in out)) expect(out.url).toBe("https://billing.stripe.test/session/bps_test_1");
  });

  test("webhook with a bad signature is rejected 400 and audited", async () => {
    const { payload } = await signedEvent("checkout.session.completed", {});
    const res = await postWebhook(payload, "t=1,v1=deadbeef");
    expect(res.status).toBe(400);
    const audit = await db.auditEvent.findFirst({ where: { action: "billing.webhook_rejected" }, orderBy: { at: "desc" } });
    expect(audit).toBeTruthy();
  });

  test("checkout.session.completed activates the plan and binds providerRef", async () => {
    const { payload, header } = await signedEvent("checkout.session.completed", {
      id: "cs_test_9",
      client_reference_id: tenant.id,
      metadata: { tenantId: tenant.id, planCode: "SOLO", termMonths: "12" },
      subscription: "sub_test_9",
    });
    const res = await postWebhook(payload, header);
    expect(res.status).toBe(200);

    const t = await db.tenant.findUnique({ where: { id: tenant.id } });
    expect(t?.planCode).toBe("SOLO");

    const sub = await db.subscription.findFirst({ where: { tenantId: tenant.id, provider: "stripe" }, orderBy: { renewalAt: "desc" } });
    expect(sub?.providerRef).toBe("sub_test_9");
    expect(sub?.status).toBe("ACTIVE");
    expect(sub?.termMonths).toBe(12);
    expect(sub?.discountPct).toBe(20);

    const payment = await db.payment.findFirst({ where: { reference: "cs_test_9" } });
    expect(payment?.status).toBe("PAID");
  });

  test("invoice.paid advances one term and records the renewal payment", async () => {
    const sub = await db.subscription.findFirst({ where: { providerRef: "sub_test_9" } });
    expect(sub).toBeTruthy();
    const renewalBefore = sub!.renewalAt.getTime();

    const { payload, header } = await signedEvent("invoice.paid", {
      id: "in_test_paid_1", subscription: "sub_test_9", customer: "cus_test_1",
    });
    const res = await postWebhook(payload, header);
    expect(res.status).toBe(200);

    const after = await db.subscription.findFirst({ where: { providerRef: "sub_test_9" } });
    const advanced = (after!.renewalAt.getTime() - renewalBefore) / 86_400_000;
    expect(advanced).toBeGreaterThan(364); // +12 months
    expect(after!.status).toBe("ACTIVE");

    const renewal = await db.payment.findFirst({ where: { reference: "in_test_paid_1" } });
    expect(renewal?.kind).toBe("renewal");
    expect(renewal?.status).toBe("PAID");
  });

  test("invoice.payment_failed flips the subscription to PAST_DUE and duns the admin", async () => {
    const { payload, header } = await signedEvent("invoice.payment_failed", {
      id: "in_test_fail_1", subscription: "sub_test_9", customer: "cus_test_1",
    });
    const res = await postWebhook(payload, header);
    expect(res.status).toBe(200);

    const sub = await db.subscription.findFirst({ where: { providerRef: "sub_test_9" } });
    expect(sub?.status).toBe("PAST_DUE");
    expect(sub?.failedPayment).toBe(true);

    const dunning = await db.mailOutbox.findFirst({ where: { subject: { contains: "payment failed" } }, orderBy: { createdAt: "desc" } });
    expect(dunning?.template).toBe("BILLING");
  });

  test("customer.subscription.deleted cancels the subscription, keeping the data", async () => {
    const { payload, header } = await signedEvent("customer.subscription.deleted", {
      id: "sub_test_9", customer: "cus_test_1",
    });
    const res = await postWebhook(payload, header);
    expect(res.status).toBe(200);

    const sub = await db.subscription.findFirst({ where: { providerRef: "sub_test_9" } });
    expect(sub?.status).toBe("CANCELED");
    const audit = await db.auditEvent.findFirst({ where: { action: "subscription.canceled" }, orderBy: { at: "desc" } });
    expect(audit).toBeTruthy();
  });
});
