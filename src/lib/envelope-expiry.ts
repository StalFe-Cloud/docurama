import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { serializableTransaction } from "@/lib/transaction";
import { queueEnvelopeEvent } from "@/lib/webhooks";

/**
 * Signing deadlines (cycle 12).
 *
 * `Envelope.expiresAt` is an optional moment chosen by the sender. There is no
 * cron: the transition to EXPIRED is evaluated lazily and idempotently at the
 * places that already gate on envelope state — the signer portal page, the
 * signing API, and the workspace envelope list. Every transition is guarded by
 * the status predicate itself (`updateMany` returns the winner), so concurrent
 * readers can race safely: exactly one wins, the others see EXPIRED on their
 * next read. The transition writes the same ledger + webhook evidence as every
 * other terminal state.
 */

/** Max horizon a sender may pick (mirrors Yousign-class products: generous but bounded). */
export const DEADLINE_MAX_DAYS = 730;

/** Parse a sender-supplied deadline. `null` return = "no deadline requested". */
export function parseSigningDeadline(value: unknown, now = new Date()): { date: Date | null; error?: string } {
  if (value === undefined || value === null || value === "") return { date: null };
  if (typeof value !== "string") return { date: null, error: "Signing deadline must be a date string (YYYY-MM-DD or ISO)." };
  const trimmed = value.trim();
  // Calendar dates are accepted at end-of-day UTC so "2026-12-01" means the
  // signer has the whole of December 1st; full ISO timestamps are honoured as-is.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T23:59:59.999Z` : trimmed;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: null, error: "Signing deadline is not a valid date." };
  if (date.getTime() <= now.getTime()) return { date: null, error: "Signing deadline must be in the future." };
  if (date.getTime() > now.getTime() + DEADLINE_MAX_DAYS * 86_400_000) {
    return { date: null, error: `Signing deadline must be within ${DEADLINE_MAX_DAYS} days.` };
  }
  return { date };
}

/** True when the envelope's deadline (if any) has passed. */
export function deadlinePassed(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return expiresAt instanceof Date && expiresAt.getTime() <= now.getTime();
}

/** Locale-aware display of a deadline (the signer-facing format). */
export function formatSigningDeadline(expiresAt: Date, locale: "en" | "fr" = "en"): string {
  return expiresAt.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

/**
 * Lazily transition every due envelope to EXPIRED. Scope by envelopeId (the
 * signer paths) or tenantId (the workspace list). Returns the envelopes that
 * THIS call transitioned (count 0 is the common, cheap case).
 *
 * Guarded by the status predicate inside a serializable transaction; each
 * winner writes one EXPIRED ledger event and queues the `envelope.expired`
 * webhook with the deadline that elapsed.
 */
export async function expireDueEnvelopes(
  scope: { envelopeId?: string; tenantId?: string },
  now = new Date(),
): Promise<number> {
  const where: Prisma.EnvelopeWhereInput = {
    status: { in: ["SENT", "PARTIALLY_SIGNED"] },
    expiresAt: { lte: now },
  };
  if (scope.envelopeId) where.id = scope.envelopeId;
  else if (scope.tenantId) where.tenantId = scope.tenantId;
  else return 0;

  const due = await db.envelope.findMany({ where, select: { id: true, tenantId: true, publicCode: true, title: true, expiresAt: true } });
  if (due.length === 0) return 0;

  let transitioned = 0;
  for (const envelope of due) {
    try {
      transitioned += await serializableTransaction(async (tx) => {
        // Re-assert the claim: another concurrent sweep may have won already.
        const claimed = await tx.envelope.updateMany({
          where: { id: envelope.id, status: { in: ["SENT", "PARTIALLY_SIGNED"] }, expiresAt: { lte: now } },
          data: { status: "EXPIRED" },
        });
        if (claimed.count !== 1) return 0;
        await tx.envelopeEvent.create({ data: {
          envelopeId: envelope.id, actor: "Docurama", action: "EXPIRED", at: now,
          detail: `Signing deadline passed (${formatSigningDeadline(envelope.expiresAt as Date)}); envelope expired without all signatures`,
        } });
        await queueEnvelopeEvent(tx, envelope.tenantId, "envelope.expired", {
          code: envelope.publicCode, title: envelope.title, status: "EXPIRED",
          expiredAt: now.toISOString(), deadline: (envelope.expiresAt as Date).toISOString(),
        });
        return 1;
      });
    } catch (error) {
      // A failed sweep never blocks the caller's read path; the next access retries.
      console.warn("[envelope-expiry] transition failed for", envelope.publicCode, error);
    }
  }
  return transitioned;
}
