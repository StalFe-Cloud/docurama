/**
 * Direct engine test: lazy renewal + carry-forward.
 * Run: DATABASE_URL="file:../db/custom.db" bun scripts/test-quota-engine.ts
 *
 * Scenarios:
 * 1. Mid-window tenant: window intact, allowance = limit + seeded rollover.
 * 2. Expired window: anchor advances, unused envelopes carry over (capped).
 * 3. Enterprise overrides: negotiated seats/envelopes win over plan defaults.
 * 4. Rollover cap: unused above one period's limit is clamped.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const DAY = 24 * 3600 * 1000;

async function main() {
  // Import the engine the same way the app does (path alias won't resolve
  // outside Next; use a relative import).
  const { quotaSnapshot, seatsUsed } = await import("../src/lib/quota");

  // ── Scenario 1: mid-window SOLO tenant ──
  const solo = await db.tenant.findUnique({ where: { slug: "camille-notaire" } });
  if (!solo) throw new Error("seed missing camille-notaire");
  await db.tenant.update({
    where: { id: solo.id },
    data: { periodStartedAt: new Date(Date.now() - 10 * DAY), envelopeRollover: 5 },
  });
  const snap1 = await quotaSnapshot(solo.id);
  const expectAllowance = 50 + 5;
  console.log(`[1] SOLO mid-window: limit=${snap1.envelopeLimit} rollover=${snap1.rollover} allowance=${snap1.allowance} (expect 50/5/${expectAllowance})`);
  if (snap1.envelopeLimit !== 50 || snap1.rollover !== 5 || snap1.allowance !== expectAllowance) throw new Error("scenario 1 failed");
  if (snap1.windowDaysRemainingLabel === undefined) void 0;

  // ── Scenario 2: expired window rolls forward with carry ──
  // SOLO window = 35 days (35-day month). Put the anchor 80 days back:
  // two windows closed. Envelopes in those windows: whatever exists with
  // createdAt >= anchor-80d is counted per-window; we set rollover high to
  // observe the cap.
  await db.tenant.update({
    where: { id: solo.id },
    data: { periodStartedAt: new Date(Date.now() - 80 * DAY), envelopeRollover: 50 },
  });
  const snap2 = await quotaSnapshot(solo.id);
  console.log(`[2] SOLO after lazy renewal: anchor=${snap2.windowStart} rollover=${snap2.rollover} allowance=${snap2.allowance} windowDays=${Math.round((snap2.windowEndsAtMs - Date.now()) / DAY)}`);
  // Anchor must be within the last 35 days and rollover capped at 50.
  const anchorAgeDays = (Date.now() - new Date(snap2.windowStart).getTime()) / DAY;
  if (anchorAgeDays > 35) throw new Error(`anchor not advanced (${anchorAgeDays.toFixed(1)}d old)`);
  if (snap2.rollover > 50) throw new Error("rollover cap violated");
  console.log(`    anchor age ${anchorAgeDays.toFixed(1)}d ≤ 35d ✓, rollover ${snap2.rollover} ≤ 50 ✓`);

  // ── Scenario 3: Enterprise overrides win ──
  const ent = await db.tenant.findUnique({ where: { slug: "stalfe" } });
  if (!ent) throw new Error("seed missing stalfe");
  const snap3 = await quotaSnapshot(ent.id);
  console.log(`[3] ENTERPRISE: seatLimit=${snap3.seatLimit} envelopeLimit=${snap3.envelopeLimit} (seeded overrides: 24 seats / 6000+ envelopes)`);
  // Seed sets seatLimitOverride = seats + 6 = 24 (negotiated, below the 100
  // plan default) and envelopeLimitOverride = 6000 + effective (> 5000 default).
  if (snap3.seatLimit !== 24) throw new Error(`seat override not applied (got ${snap3.seatLimit}, want 24)`);
  if (snap3.envelopeLimit <= 5000) throw new Error("envelope override not applied");

  // ── Scenario 4: seats include pending invites ──
  const seats = await seatsUsed(solo.id);
  console.log(`[4] seatsUsed members=${seats.members} invites=${seats.invites} → snapshot seatsUsed=${snap2.seatsUsed}`);
  if (snap2.seatsUsed !== seats.members + seats.invites) throw new Error("seat accounting mismatch");

  console.log("\nALL QUOTA ENGINE SCENARIOS PASSED");
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exit(1); })
  .finally(() => db.$disconnect());
