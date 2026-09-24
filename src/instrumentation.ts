/** Database-backed workers: one awaited timer chain, with per-job leases. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DOCURAMA_WORKER === "off" ||
      process.env.NEXT_PHASE === "phase-production-build") return;
  const global = globalThis as unknown as { __docuramaWorker?: () => void };
  if (global.__docuramaWorker) return;
  const [{ processOutbox }, { retryFailedDeliveries }, { renewDueSubscriptions }, { maintainSealedPdfs }, { runReminderPass }, { startWorkerLoop }] = await Promise.all([
    import("@/lib/mail"), import("@/lib/webhooks"), import("@/lib/billing"), import("@/lib/signed-pdf"), import("@/lib/reminders"), import("@/lib/worker-loop"),
  ]);
  if (global.__docuramaWorker) return;
  const tick = async () => {
    try {
      const mail = await processOutbox(20);
      if (mail.processed) console.log(`[worker] mail: ${mail.sent} sent, ${mail.deferred} deferred, ${mail.failed} failed`);
    } catch (error) { console.warn("[worker] mail pass failed", error); }
    try {
      const hooks = await retryFailedDeliveries(10);
      if (hooks.retried) console.log(`[worker] webhooks: ${hooks.retried} processed, ${hooks.recovered} delivered`);
    } catch (error) { console.warn("[worker] webhook pass failed", error); }
    try {
      const renewals = await renewDueSubscriptions(20);
      if (renewals.length) console.log(`[worker] billing: ${renewals.length} term renewals`);
    } catch (error) { console.warn("[worker] billing pass failed", error); }
    try {
      const reminders = await runReminderPass({ limit: 50 });
      if (reminders.reminded) console.log(`[worker] reminders: ${reminders.reminded} queued`);
    } catch (error) { console.warn("[worker] reminder pass failed", error); }
    try {
      const pdfs = await maintainSealedPdfs({ limit: 5 });
      if (pdfs.extended || pdfs.renewed) console.log(`[worker] signed PDFs: ${pdfs.extended} raised to a long-term level, ${pdfs.renewed} archive timestamps renewed`);
    } catch (error) { console.warn("[worker] signed PDF pass failed", error); }
  };
  global.__docuramaWorker = startWorkerLoop(tick, { initialDelayMs: 5_000, intervalMs: 30_000,
    onError: (error) => console.warn("[worker] pass failed", error) });
  process.once("SIGTERM", global.__docuramaWorker);
  process.once("SIGINT", global.__docuramaWorker);
  console.log("[worker] background worker started (mail + webhook retries + subscription renewals + reminders + signed PDF upkeep)");
}
