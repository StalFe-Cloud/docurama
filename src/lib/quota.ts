/**
 * Quota engine — lazy billing-window renewal with unused-envelope carry-forward.
 *
 * There is no cron. Every quota read (envelope send, dashboard, admin billing)
 * calls `quotaSnapshot()`, which advances the tenant's billing window while
 * `now >= periodStartedAt + windowMs`:
 *
 *   1. envelopes used in the closing window are counted,
 *   2. unused envelopes carry into the next window, capped at one full
 *      period's limit (so the maximum allowance is 2× the plan limit),
 *   3. the window anchor moves forward one period at a time (guard: 24
 *      iterations, i.e. two years of monthly windows),
 *   4. the active subscription's renewal/invoice stamps are synced.
 *
 * Effective limits come from the plan row, unless the subscription negotiated
 * Enterprise overrides (seats, envelopes, price) during lead conversion.
 */

import { db } from "@/lib/db";
import { billingPeriod, planDef, periodMs, rolloverCap, monthlyEffectiveEur } from "@/lib/billing";
import type { Plan, Subscription, Tenant } from "@prisma/client";

const DAY_MS = 24 * 3600 * 1000;
/** Safety guard: at most 24 window advances per read (2 years monthly, 2 years biennial). */
const MAX_ADVANCES = 24;

export interface QuotaSnapshot {
  planCode: string;
  planName: string;
  tenantStatus: string;
  trialEndsAt: string | null;
  /** Negotiated (true) limits — overrides applied. */
  envelopeLimit: number;
  seatLimit: number;
  storageGb: number;
  apiAccess: boolean;
  periodDays: number;
  billingMonths: number;
  discountPct: number;
  monthlyEffectiveEur: number;
  /** limit + rollover */
  allowance: number;
  used: number;
  remaining: number;
  rollover: number;
  windowStart: string;
  windowEnd: string;
  /** UNIX ms — null when the window never expires (should not happen). */
  windowEndsAtMs: number;
  seatsUsed: number;
  seatsRemaining: number;
  seatsOccupiedByInvites: number;
}

interface Loaded {
  tenant: Tenant;
  subscription: Subscription | null;
  plan: Plan | null;
}

/** Latest subscription that represents the current commercial relationship. */
async function loadCurrent(tenantId: string): Promise<Loaded> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("Tenant not found");
  const subscription = await db.subscription.findFirst({
    where: { tenantId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    orderBy: { createdAt: "desc" },
  });
  const plan = (await db.plan.findUnique({ where: { code: tenant.planCode } })) ?? null;
  return { tenant, subscription, plan };
}

/** ACTIVE members + PENDING unexpired invitations (an invite reserves a seat). */
export async function seatsUsed(tenantId: string): Promise<{ members: number; invites: number }> {
  const [members, invites] = await Promise.all([
    db.member.count({ where: { tenantId, status: "ACTIVE" } }),
    db.invitation.count({ where: { tenantId, status: "PENDING", expiresAt: { gt: new Date() } } }),
  ]);
  return { members, invites };
}

function effectiveLimits({ tenant, subscription, plan }: Loaded) {
  const def = planDef(tenant.planCode);
  const envelopeLimit = subscription?.envelopeLimitOverride ?? plan?.envelopeLimit ?? def?.envelopeLimit ?? 100;
  const seatLimit = subscription?.seatLimitOverride ?? plan?.seatLimit ?? def?.seatLimit ?? 3;
  const storageGb = plan?.storageGb ?? def?.storageGb ?? 5;
  const apiAccess = plan?.apiAccess ?? def?.apiAccess ?? false;
  const periodDays = plan?.periodDays ?? def?.periodDays ?? 30;
  const listPrice = subscription?.priceEurOverride ?? plan?.monthlyEur ?? def?.monthlyEur ?? 0;
  const billingMonths = subscription?.billingMonths ?? 1;
  const discountPct = subscription?.discountPct ?? 0;
  const monthlyEffective = def?.customPricing && subscription?.priceEurOverride == null
    ? 0 // custom-priced deal without a negotiated number yet
    : monthlyEffectiveEur(listPrice, billingMonths);
  return { envelopeLimit, seatLimit, storageGb, apiAccess, periodDays, billingMonths, discountPct, monthlyEffective };
}

/**
 * The heart of the engine: reads the tenant's quota state, lazily rolling
 * expired billing windows forward and carrying unused envelopes over.
 */
export async function quotaSnapshot(tenantId: string): Promise<QuotaSnapshot> {
  const loaded = await loadCurrent(tenantId);
  const { tenant } = loaded;
  const limits = effectiveLimits(loaded);
  const windowMs = periodMs(limits.periodDays, limits.billingMonths);

  let anchor = tenant.periodStartedAt ?? tenant.createdAt;
  let rollover = tenant.envelopeRollover;
  const now = Date.now();

  // ── Lazy renewal loop ──
  let advanced = 0;
  let changed = false;
  while (anchor.getTime() + windowMs <= now && advanced < MAX_ADVANCES) {
    const windowEnd = new Date(anchor.getTime() + windowMs);
    const usedInWindow = await db.envelope.count({
      where: { tenantId, createdAt: { gte: anchor, lt: windowEnd } },
    });
    const unused = Math.max(0, limits.envelopeLimit + rollover - usedInWindow);
    // Carry-forward: capped at one full period's limit.
    rollover = Math.min(unused, rolloverCap(limits.envelopeLimit));
    anchor = windowEnd;
    advanced += 1;
    changed = true;
  }

  if (changed) {
    await db.tenant.update({
      where: { id: tenantId },
      data: { periodStartedAt: anchor, envelopeRollover: rollover },
    });
    // Keep the subscription's renewal stamp aligned with the rolled window.
    if (loaded.subscription) {
      await db.subscription.update({
        where: { id: loaded.subscription.id },
        data: {
          renewalAt: new Date(anchor.getTime() + windowMs),
          lastInvoiceAt: anchor,
          mrrEur: limits.monthlyEffective,
        },
      });
    }
  }

  const used = await db.envelope.count({
    where: { tenantId, createdAt: { gte: anchor } },
  });
  const allowance = limits.envelopeLimit + rollover;
  const seatUse = await seatsUsed(tenantId);
  const def = planDef(tenant.planCode);

  return {
    planCode: tenant.planCode,
    planName: loaded.plan?.name ?? def?.name ?? tenant.planCode,
    tenantStatus: tenant.status,
    trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
    envelopeLimit: limits.envelopeLimit,
    seatLimit: limits.seatLimit,
    storageGb: limits.storageGb,
    apiAccess: limits.apiAccess,
    periodDays: limits.periodDays,
    billingMonths: limits.billingMonths,
    discountPct: limits.discountPct,
    monthlyEffectiveEur: limits.monthlyEffective,
    allowance,
    used,
    remaining: Math.max(0, allowance - used),
    rollover,
    windowStart: anchor.toISOString(),
    windowEnd: new Date(anchor.getTime() + windowMs).toISOString(),
    windowEndsAtMs: anchor.getTime() + windowMs,
    seatsUsed: seatUse.members + seatUse.invites,
    seatsRemaining: Math.max(0, limits.seatLimit - seatUse.members - seatUse.invites),
    seatsOccupiedByInvites: seatUse.invites,
  };
}

// ─── Enforcement helpers ─────────────────────────────────────────────────────

export interface CheckResult {
  ok: boolean;
  status: number;
  message?: string;
  snapshot?: QuotaSnapshot;
}

/** Gate for creating an envelope: tenant must be healthy and have quota left. */
export async function checkEnvelopeQuota(tenantId: string): Promise<CheckResult> {
  const snapshot = await quotaSnapshot(tenantId);
  if (snapshot.tenantStatus === "SUSPENDED") {
    return {
      ok: false,
      status: 403,
      message: "This workspace is suspended — contact support to restore sending before the next envelope.",
      snapshot,
    };
  }
  if (snapshot.remaining <= 0) {
    const periodLabel = snapshot.periodDays === 30 ? "this period" : "this 35-day period";
    return {
      ok: false,
      status: 402,
      message:
        `Envelope allowance reached (${snapshot.used}/${snapshot.allowance} in ${periodLabel}). ` +
        (snapshot.rollover > 0
          ? `${snapshot.rollover} unused envelopes carried over are already included. `
          : "Unused envelopes automatically carry over at renewal. ") +
        "Upgrade your plan in Settings to send more immediately.",
      snapshot,
    };
  }
  return { ok: true, status: 200, snapshot };
}

/** Gate for inviting a teammate: pending invites reserve seats. */
export async function checkSeatAvailable(tenantId: string): Promise<CheckResult> {
  const snapshot = await quotaSnapshot(tenantId);
  if (snapshot.seatsRemaining <= 0) {
    return {
      ok: false,
      status: 402,
      message:
        `All ${snapshot.seatLimit} seats are taken (${snapshot.seatsUsed} members and pending invites). ` +
        "Revoke an unused invitation or upgrade your plan to add more teammates.",
      snapshot,
    };
  }
  return { ok: true, status: 200, snapshot };
}

/** Gate for API key creation: plan must include API access. */
export async function checkApiAccess(tenantId: string): Promise<CheckResult> {
  const snapshot = await quotaSnapshot(tenantId);
  if (!snapshot.apiAccess) {
    return {
      ok: false,
      status: 402,
      message:
        "API access is included from the Smart Team plan upward. Upgrade in Settings → Account to create API keys.",
      snapshot,
    };
  }
  return { ok: true, status: 200, snapshot };
}

/** Human summary for dashboards: "34 of 100 sent · 12 carried over". */
export function quotaSummaryLine(s: QuotaSnapshot): string {
  const base = `${s.used} of ${s.allowance} sent`;
  return s.rollover > 0 ? `${base} · ${s.rollover} carried over` : base;
}

/** How many days remain in the current billing window (min 0). */
export function windowDaysRemaining(s: QuotaSnapshot): number {
  return Math.max(0, Math.ceil((s.windowEndsAtMs - Date.now()) / DAY_MS));
}

export { billingPeriod };
