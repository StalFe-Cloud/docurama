/**
 * Automated reminders (Settings > Notifications > Reminders), run by the
 * background worker.
 *
 * An active envelope is reminded when its workspace runs the platform job, or
 * when the sender turned auto-remind on for it. The workspace policy applies:
 * interval since the last reminder (or since sending), maximum count, no
 * weekends, no quiet hours (Europe/Paris, as the settings page states). Only
 * the signer whose turn it is gets the email; the others cannot sign yet.
 */
import type { NotificationSettings } from "@prisma/client";
import { db } from "@/lib/db";
import { appOrigin } from "@/lib/app-origin";
import { queueReminders } from "@/lib/notify";
import { queueEnvelopeEvent } from "@/lib/webhooks";

type Policy = Pick<NotificationSettings, "reminderMode" | "reminderIntervalDays" | "reminderMaxCount" | "quietHoursStart" | "quietHoursEnd" | "skipWeekends">;

const DEFAULT_POLICY: Policy = {
  reminderMode: "manual", reminderIntervalDays: 3, reminderMaxCount: 5, quietHoursStart: "21:00", quietHoursEnd: "08:00", skipWeekends: true,
};

/** Hour (0-23) and weekend flag in Europe/Paris. */
function parisClock(now: Date): { hour: number; weekend: boolean } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  return { hour, weekend: weekday === "Sat" || weekday === "Sun" };
}

export type ReminderDecision = { due: true; reason: string } | { due: false; skip: "manual" | "max" | "throttle" | "weekend" | "quiet" };

/** Whether an envelope is due a reminder now; shared by the worker and the settings preview. */
export function reminderDecision(policy: Policy | null, envelope: { autoRemind: boolean; reminderCount: number; lastRemindedAt: Date | null; createdAt: Date }, now: Date): ReminderDecision {
  const p = policy ?? DEFAULT_POLICY;
  if (p.reminderMode !== "platform_job" && !envelope.autoRemind) return { due: false, skip: "manual" };
  if (envelope.reminderCount >= p.reminderMaxCount) return { due: false, skip: "max" };
  const since = (now.getTime() - (envelope.lastRemindedAt ?? envelope.createdAt).getTime()) / 86_400_000;
  if (since < p.reminderIntervalDays) return { due: false, skip: "throttle" };
  const clock = parisClock(now);
  if (p.skipWeekends && clock.weekend) return { due: false, skip: "weekend" };
  const start = Number(p.quietHoursStart.slice(0, 2));
  const end = Number(p.quietHoursEnd.slice(0, 2));
  const quiet = start > end ? clock.hour >= start || clock.hour < end : clock.hour >= start && clock.hour < end;
  if (quiet) return { due: false, skip: "quiet" };
  return { due: true, reason: envelope.autoRemind ? "auto-remind on this envelope" : "workspace reminder schedule" };
}

/**
 * One worker pass. Each reminder is claimed by bumping the envelope's
 * reminder count conditionally, so two app instances never both send it.
 */
export async function runReminderPass(opts: { now?: Date; limit?: number } = {}): Promise<{ reminded: number }> {
  const now = opts.now ?? new Date();
  const candidates = await db.envelope.findMany({
    where: {
      status: { in: ["SENT", "PARTIALLY_SIGNED"] },
      tenant: { status: { not: "SUSPENDED" } },
      OR: [{ autoRemind: true }, { tenant: { notificationSettings: { is: { reminderMode: "platform_job" } } } }],
    },
    include: {
      recipients: true,
      createdBy: { select: { email: true, firstName: true, lastName: true } },
      tenant: { select: { notificationSettings: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  let reminded = 0;
  for (const e of candidates) {
    if (reminded >= (opts.limit ?? 50)) break;
    const decision = reminderDecision(e.tenant.notificationSettings, e, now);
    if (!decision.due) continue;
    const next = e.recipients.filter((r) => r.role === "SIGNER").sort((a, b) => a.order - b.order)
      .find((r) => r.status === "PENDING" || r.status === "DELIVERED");
    if (!next?.accessToken) continue;
    const sent = await db.$transaction(async (tx) => {
      const claimed = await tx.envelope.updateMany({
        where: { id: e.id, reminderCount: e.reminderCount, status: { in: ["SENT", "PARTIALLY_SIGNED"] } },
        data: { reminderCount: { increment: 1 }, lastRemindedAt: now },
      });
      if (!claimed.count) return false;
      await queueReminders(tx, e, [next], { origin: appOrigin(), createdAt: now });
      await tx.envelopeEvent.create({ data: {
        envelopeId: e.id, actor: "Docurama", action: "REMINDED", at: now,
        detail: `Automated reminder queued for ${next.name} (${decision.reason})`,
      } });
      await queueEnvelopeEvent(tx, e.tenantId, "reminder.sent", { code: e.publicCode, title: e.title, status: e.status });
      return true;
    });
    if (sent) reminded++;
  }
  return { reminded };
}
