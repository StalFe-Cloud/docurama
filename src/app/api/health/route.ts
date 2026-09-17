import { writeFile, rm, mkdir } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { storageDir } from "@/lib/document-store";
import { smtpMode, outboxStats } from "@/lib/mail";
import { rekorWitnessingEnabled, getPortalKeyWitness } from "@/lib/rekor";

/**
 * Operational health endpoint — the target the runbook monitors
 * (PRODUCTION-PLAN §3/§8) and the probe the Docker HEALTHCHECK and Helm
 * liveness/readiness probes call.
 *
 *   200  process up, database reachable, storage writable
 *   503  any critical check failed (container orchestrators restart/respect)
 *
 * Payload is operational state only — no tenant data, no config values.
 * Keep the app version literal in sync with package.json.
 */

export const dynamic = "force-dynamic";

const APP_VERSION = "0.3.0";

export async function GET() {
  const startedAt = Date.now();
  const checks: Record<string, unknown> = {};

  // Critical: database round-trip.
  let dbOk = false;
  let dbLatencyMs: number | null = null;
  try {
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - t0;
    dbOk = true;
  } catch (err) {
    checks.database = { ok: false, error: err instanceof Error ? err.message : "unreachable" };
  }
  if (dbOk) checks.database = { ok: true, latencyMs: dbLatencyMs };

  // Critical: storage tree writable (uploads and page renders land here).
  try {
    const dir = storageDir();
    const probe = path.join(dir, ".health-probe");
    await mkdir(dir, { recursive: true });
    await writeFile(probe, `${Date.now()}\n`);
    await rm(probe, { force: true });
    checks.storage = { ok: true };
  } catch (err) {
    checks.storage = { ok: false, error: err instanceof Error ? err.message : "not writable" };
  }

  // Informational: mail delivery mode + queue depth.
  const mailMode = smtpMode().configured ? "smtp" : "outbox-only";
  try {
    checks.mail = { mode: mailMode, ...(await outboxStats()) };
  } catch {
    checks.mail = { mode: mailMode };
  }

  // Informational: transparency witnessing posture.
  try {
    const witnessed = (await getPortalKeyWitness()) !== null;
    checks.rekor = { enabled: rekorWitnessingEnabled(), witnessed };
  } catch {
    checks.rekor = { enabled: rekorWitnessingEnabled(), witnessed: false };
  }

  // Informational: webhook endpoints health summary.
  try {
    const [endpoints, failing] = await Promise.all([
      db.webhookEndpoint.count(),
      db.webhookEndpoint.count({ where: { status: "FAILING" } }),
    ]);
    checks.webhooks = { endpoints, failing };
  } catch {
    checks.webhooks = { endpoints: null, failing: null };
  }

  const criticalOk =
    (checks.database as { ok: boolean }).ok === true && (checks.storage as { ok: boolean }).ok === true;

  return Response.json(
    {
      status: criticalOk ? "ok" : "unready",
      version: APP_VERSION,
      uptimeSec: Math.round(process.uptime()),
      checkedInMs: Date.now() - startedAt,
      checks,
    },
    { status: criticalOk ? 200 : 503 },
  );
}
