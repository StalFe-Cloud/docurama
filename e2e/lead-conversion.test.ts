/// <reference types="bun-types" />

/**
 * Enterprise lead → tenant conversion.
 *
 * Run alone: bun test e2e/lead-conversion.test.ts. Owns a fresh scratch DB and
 * next/headers, like e2e/auth-security.test.ts.
 *
 * BUSINESS and ENTERPRISE are not in SELF_SERVE_PLANS (src/lib/plans.ts), so
 * this admin operation is the only path that creates them. What it has to get
 * right: the WON guard, idempotency, the negotiated entitlements actually
 * reaching the billing layer, and inviting the contact rather than minting a
 * user with a password nobody chose.
 */

import { afterAll, describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { Database } from "bun:sqlite";

const scratchDir = mkdtempSync(join(tmpdir(), "docurama-lead-conversion-"));
process.env.DATABASE_URL = `file:${join(scratchDir, "lead.db").replace(/\\/g, "/")}`;
new Database(join(scratchDir, "lead.db"), { create: true }).close();
execFileSync("node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], {
  env: process.env, stdio: "pipe",
});

let cookieToken: string | undefined;
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieToken ? { value: cookieToken } : undefined) }),
  headers: async () => new Headers(),
}));

const { db } = await import("../src/lib/db");
const billing = await import("../src/lib/billing");
const { planDef } = await import("../src/lib/plans");
const adminRoute = await import("../src/app/api/admin/[section]/route");

let sequence = 0;
const unique = () => `lead-${++sequence}`;

/** Sign in as a platform admin for the duration of the suite. */
const admin = await db.user.create({
  data: {
    email: "lead-admin@example.test",
    firstName: "Lead",
    lastName: "Admin",
    passwordHash: "unused",
    role: "PLATFORM_ADMIN",
  },
});
const session = await db.session.create({
  data: { userId: admin.id, expiresAt: new Date(Date.now() + 3600_000) },
});
cookieToken = session.id;

afterAll(async () => {
  await db.$disconnect();
  rmSync(scratchDir, { recursive: true, force: true });
});

const ctx = { params: Promise.resolve({ section: "leads" }) };

async function convert(id: string, data: Record<string, unknown> = {}) {
  const res = await adminRoute.POST(
    new NextRequest("http://127.0.0.1:3000/api/admin/leads", {
      method: "POST",
      body: JSON.stringify({ op: "lead.convert", id, data }),
    }),
    ctx,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function newLead(overrides: Record<string, unknown> = {}) {
  return db.enterpriseLead.create({
    data: {
      company: `Werner Stahlbau ${unique()}`,
      contactName: "Erika Werner",
      email: `${unique()}@example.test`,
      status: "WON",
      seats: 40,
      monthlyEnvelopes: 5000,
      ...overrides,
    },
  });
}

describe("enterprise lead conversion", () => {
  test("only a WON lead converts", async () => {
    for (const status of ["NEW", "CONTACTED", "QUALIFIED", "LOST"]) {
      const lead = await newLead({ status });
      const { body } = await convert(lead.id);
      expect(String(body.error)).toMatch(/Only a WON lead/);
      expect(await db.tenant.count({ where: { name: lead.company } })).toBe(0);
    }
  });

  test("a missing lead 404s", async () => {
    const { status } = await convert("does-not-exist");
    expect(status).toBe(404);
  });

  test("converting creates the tenant, subscription, owner invite and audit trail", async () => {
    const lead = await newLead();
    const { body } = await convert(lead.id, {
      planCode: "ENTERPRISE",
      seatLimitOverride: 250,
      envelopeLimitOverride: 40_000,
      monthlyEurOverride: 1_800,
    });

    expect(body.ok).toBe(true);
    const tenantId = String(body.tenantId);
    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
    expect(tenant?.name).toBe(lead.company);
    expect(tenant?.planCode).toBe("ENTERPRISE");
    expect(tenant?.status).toBe("ACTIVE");
    // Billing contact carries over from the lead.
    expect(tenant?.billingEmail).toBe(lead.email);
    // Slug is derived but uniquified, never the bare company name.
    expect(tenant?.slug).toMatch(/^werner-stahlbau-lead-\d+-[0-9a-f]{6}$/);

    const sub = await db.subscription.findFirst({ where: { tenantId } });
    expect(sub?.planCode).toBe("ENTERPRISE");
    expect(sub?.status).toBe("ACTIVE");
    expect(sub?.seatLimitOverride).toBe(250);
    expect(sub?.envelopeLimitOverride).toBe(40_000);
    expect(sub?.monthlyEurOverride).toBe(1_800);
    expect(sub?.mrrEur).toBe(1_800);

    // The contact has no account, so they are invited as OWNER.
    const invite = await db.invitation.findFirst({ where: { tenantId } });
    expect(invite?.email).toBe(lead.email);
    expect(invite?.role).toBe("OWNER");
    expect(invite?.status).toBe("PENDING");
    expect(body.invited).toBe(true);
    // No user is minted with a password nobody chose.
    expect(await db.user.count({ where: { email: lead.email } })).toBe(0);

    const audit = await db.auditEvent.findFirst({
      where: { action: "enterprise.lead.converted", resource: `lead:${lead.id}` },
    });
    expect(audit).toBeTruthy();
    expect(audit?.detail).toContain("250");
    expect(audit?.detail).toContain("40000");
  });

  test("the negotiated numbers are what the billing layer enforces", async () => {
    const lead = await newLead();
    const { body } = await convert(lead.id, {
      planCode: "BUSINESS",
      seatLimitOverride: 175,
      envelopeLimitOverride: 33_000,
    });
    const tenantId = String(body.tenantId);

    // Not the BUSINESS catalogue numbers — the contracted ones.
    const catalogue = planDef("BUSINESS");
    expect(catalogue.seatLimit).not.toBe(175);
    expect(catalogue.envelopeLimit).not.toBe(33_000);

    const seats = await billing.seatCapacity(tenantId);
    expect(seats.seatLimit).toBe(175);
    // The owner invitation already holds one seat.
    expect(seats.pendingInvites).toBe(1);
    expect(seats.remaining).toBe(174);

    const allowance = await billing.currentAllowance(tenantId);
    expect(allowance.limit).toBe(33_000);
    expect(allowance.total).toBe(33_000);
    expect(allowance.remaining).toBe(33_000);
  });

  test("omitted overrides fall back to what the lead asked for", async () => {
    const lead = await newLead({ seats: 40, monthlyEnvelopes: 5_000 });
    const { body } = await convert(lead.id, { planCode: "ENTERPRISE" });
    const tenantId = String(body.tenantId);

    const sub = await db.subscription.findFirst({ where: { tenantId } });
    expect(sub?.seatLimitOverride).toBe(40);
    expect(sub?.envelopeLimitOverride).toBe(5_000);
    // No price was negotiated, so the catalogue rate stands.
    expect(sub?.monthlyEurOverride).toBeNull();

    expect((await billing.seatCapacity(tenantId)).seatLimit).toBe(40);
  });

  test("a lead with no numbers falls all the way back to the plan catalogue", async () => {
    const lead = await newLead({ seats: 0, monthlyEnvelopes: 0 });
    const { body } = await convert(lead.id, { planCode: "ENTERPRISE" });
    const tenantId = String(body.tenantId);

    const sub = await db.subscription.findFirst({ where: { tenantId } });
    expect(sub?.seatLimitOverride).toBeNull();
    expect(sub?.envelopeLimitOverride).toBeNull();

    const catalogue = planDef("ENTERPRISE");
    expect((await billing.seatCapacity(tenantId)).seatLimit).toBe(catalogue.seatLimit);
  });

  test("converting twice is a no-op, not a second tenant", async () => {
    const lead = await newLead();
    const first = await convert(lead.id, { planCode: "ENTERPRISE" });
    const second = await convert(lead.id, { planCode: "ENTERPRISE" });

    expect(second.body.alreadyConverted).toBe(true);
    expect(second.body.tenantId).toBe(first.body.tenantId);
    expect(await db.tenant.count({ where: { name: lead.company } })).toBe(1);
    expect(await db.subscription.count({ where: { tenantId: String(first.body.tenantId) } })).toBe(1);

    const stored = await db.enterpriseLead.findUnique({ where: { id: lead.id } });
    expect(stored?.convertedTenantId).toBe(String(first.body.tenantId));
    expect(stored?.convertedAt).toBeTruthy();
  });

  test("concurrent converts still mint exactly one tenant", async () => {
    const lead = await newLead();
    const results = await Promise.all([
      convert(lead.id, { planCode: "ENTERPRISE" }),
      convert(lead.id, { planCode: "ENTERPRISE" }),
      convert(lead.id, { planCode: "ENTERPRISE" }),
    ]);
    // Whichever ordering the runtime picks, the lead points at one tenant and
    // only that tenant exists — the compare-and-set claim rolls the losers back.
    expect(await db.tenant.count({ where: { name: lead.company } })).toBe(1);
    const stored = await db.enterpriseLead.findUnique({ where: { id: lead.id } });
    const tenantIds = new Set(results.map((r) => String(r.body.tenantId)));
    expect(tenantIds.has(String(stored?.convertedTenantId))).toBe(true);
  });

  test("an unknown plan is refused before anything is created", async () => {
    const lead = await newLead();
    const { body } = await convert(lead.id, { planCode: "PLATINUM" });
    expect(String(body.error)).toMatch(/Invalid plan/);
    expect(await db.tenant.count({ where: { name: lead.company } })).toBe(0);
    const stored = await db.enterpriseLead.findUnique({ where: { id: lead.id } });
    expect(stored?.convertedTenantId).toBeNull();
  });
});
