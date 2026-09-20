/** Monthly usage windows are UTC billing anniversaries, not payment terms. */
export type MeteredSubscription = {
  renewalAt: Date;
  termMonths: number;
  usageAnchorAt?: Date | null;
  usagePeriodStart?: Date | null;
  usagePeriodEnd?: Date | null;
};

export function shiftUtcMonth(anchor: Date, months: number): Date {
  if (!Number.isFinite(anchor.getTime()) || !Number.isSafeInteger(months)) {
    throw new Error("Invalid monthly billing boundary");
  }
  const result = new Date(anchor);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
  return result;
}

export function usageAnchor(subscription: MeteredSubscription | null, now = new Date()): Date {
  if (!subscription) return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (subscription.usageAnchorAt) return new Date(subscription.usageAnchorAt);
  const months = [1, 3, 6, 12].includes(subscription.termMonths) ? subscription.termMonths : 1;
  return shiftUtcMonth(subscription.renewalAt, -months);
}

/** Recompute from the anchor each time: Jan 31 -> Feb 28 -> Mar 31, without drift. */
export function monthlyWindow(subscription: MeteredSubscription | null, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid metering time");
  const anchor = usageAnchor(subscription, now);
  let offset = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + now.getUTCMonth() - anchor.getUTCMonth();
  if (shiftUtcMonth(anchor, offset) > now) offset--;
  const start = shiftUtcMonth(anchor, offset);
  const end = shiftUtcMonth(anchor, offset + 1);
  return { anchor, start, end, key: start.toISOString() };
}

export function periodStart(subscription: MeteredSubscription | null, now = new Date()): Date {
  return monthlyWindow(subscription, now).start;
}

/** Calendar key for reporting; reservations use the full anniversary timestamp. */
export function periodKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
