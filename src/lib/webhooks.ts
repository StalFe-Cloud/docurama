/**
 * Webhook dispatcher — delivers signed event notifications to tenant-registered
 * endpoints, with snapshot-based retries.
 *
 * Contract (what a receiver sees):
 *   POST <endpoint.url>
 *   Content-Type: application/json
 *   X-Docurama-Event:    envelope.completed
 *   X-Docurama-Delivery: <delivery id>          — stable across retries
 *   X-Docurama-Signature: sha256=<hex hmac>     — HMAC-SHA256 over the raw
 *                                                  body with the endpoint's
 *                                                  whsec_… secret
 *
 *   Body: { "id": <delivery id>, "event": …, "createdAt": …, "data": { … } }
 *
 * The payload is snapshotted on the first attempt; retries re-POST the exact
 * same bytes, so a receiver that verifies the HMAC can treat a retry as
 * byte-identical evidence. Retries run in the background worker with capped
 * exponential backoff; after MAX_WEBHOOK_ATTEMPTS the delivery row stays
 * failed (visible in Settings → API) and the endpoint is marked FAILING
 * once its recent deliveries stop succeeding.
 *
 * Firing an event is always non-fatal to the product action that produced it
 * — callers use fire-and-forget, same policy as the transparency append.
 */

import { createHmac, randomUUID } from "crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { db } from "@/lib/db";

export const MAX_WEBHOOK_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 8_000;
const DELIVERY_LEASE_MS = 30_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

function blockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
  }
  const x = ip.toLowerCase().split("%")[0];
  return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("::ffff:127.") || x.startsWith("::ffff:10.") || x.startsWith("::ffff:192.168.");
}

export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  const devLoopback = process.env.NODE_ENV !== "production" && process.env.DOCURAMA_ALLOW_PRIVATE_WEBHOOKS === "1";
  if (url.protocol !== "https:" && !devLoopback) throw new Error("webhook endpoints must use HTTPS");
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("unsupported webhook scheme");
  if (url.username || url.password) throw new Error("webhook URLs must not contain credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (devLoopback && (host === "localhost" || host === "127.0.0.1" || host === "::1")) return url;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("internal webhook host is not allowed");
  if (net.isIP(host)) {
    if (blockedIp(host)) throw new Error("private webhook address is not allowed");
  } else {
    const answers = await dns.lookup(host, { all: true, verbatim: true });
    if (!answers.length || answers.some((a) => blockedIp(a.address))) throw new Error("webhook host resolves to a private address");
  }
  return url;
}

/** Documented schedule: 1m, 5m, 15m, then flat 30m for later attempts. */
const WEBHOOK_BACKOFF_MS = [60_000, 300_000, 900_000, 1_800_000];
export function webhookBackoffMs(attempt: number): number {
  const i = Math.max(0, Math.min(attempt - 1, WEBHOOK_BACKOFF_MS.length - 1));
  return WEBHOOK_BACKOFF_MS[i];
}

export type EnvelopeEventData = {
  code: string;
  title: string;
  status: string;
  tenantId?: never; // never leak internal ids in payloads
  [k: string]: unknown;
};

export function signPayload(secret: string | null | undefined, body: string): string | null {
  if (!secret) return null;
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function endpointSubscribed(events: string, event: string): boolean {
  return events
    .split("|")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .some((e) => e === "*" || e === event);
}

/** POST a payload once to one endpoint URL. Throws on network failure or non-2xx. */
export async function postOnce(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ statusCode: number }> {
  await assertSafeWebhookUrl(url);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    redirect: "error",
  });
  if (!res.ok) throw Object.assign(new Error(`endpoint returned ${res.status}`), { statusCode: res.status });
  // Drain the body so the socket is reusable, then report the real code.
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_RESPONSE_BYTES) await res.body?.cancel().catch(() => undefined);
  else {
    const reader = res.body?.getReader();
    let seen = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      if (seen > MAX_RESPONSE_BYTES) { await reader.cancel(); break; }
    }
  }
  return { statusCode: res.status };
}

export type DispatchResult = { endpoints: number; delivered: number; failed: number };

/**
 * Fire an envelope lifecycle event to every subscribed, non-paused endpoint
 * of the tenant. Creates one WebhookDelivery row per endpoint (success or
 * failure) and refreshes endpoint health (successRate, lastDeliveryAt,
 * FAILING). Never throws.
 */
export async function dispatchEnvelopeEvent(
  tenantId: string,
  event: string,
  data: EnvelopeEventData,
): Promise<DispatchResult> {
  const result: DispatchResult = { endpoints: 0, delivered: 0, failed: 0 };
  try {
    const endpoints = await db.webhookEndpoint.findMany({
      where: { tenantId, status: { not: "PAUSED" } },
    });

    for (const ep of endpoints) {
      if (!endpointSubscribed(ep.events, event)) continue;
      result.endpoints++;

      const deliveryId = randomUUID();
      const payload = JSON.stringify({ id: deliveryId, event, createdAt: new Date().toISOString(), data });
      const headers: Record<string, string> = {
        "X-Docurama-Event": event,
        "X-Docurama-Delivery": deliveryId,
      };
      const signature = signPayload(ep.secret, payload);
      if (signature) headers["X-Docurama-Signature"] = signature;

      const started = Date.now();
      let statusCode = 0;
      let success = false;
      try {
        const r = await postOnce(ep.url, payload, headers);
        statusCode = r.statusCode;
        success = true;
      } catch (err) {
        statusCode = (err as { statusCode?: number }).statusCode ?? 0;
      }
      const durationMs = Date.now() - started;
      const attempts = 1;
      const retryable = !success && attempts < MAX_WEBHOOK_ATTEMPTS;

      await db.webhookDelivery.create({
        data: {
          id: deliveryId,
          endpointId: ep.id,
          event,
          statusCode,
          durationMs,
          success,
          payload,
          attempts,
          nextAttemptAt: retryable ? new Date(Date.now() + webhookBackoffMs(attempts)) : null,
        },
      });
      if (success) result.delivered++;
      else result.failed++;

      await refreshEndpointHealth(ep.id);
    }
  } catch (err) {
    console.warn(`[webhooks] dispatch of ${event} failed:`, err);
  }
  return result;
}

/**
 * Recompute successRate over the last 20 deliveries; flag FAILING on a
 * 5-delivery losing streak, clear it once a delivery succeeds again.
 * PAUSED is a human decision and is never touched here.
 */
async function refreshEndpointHealth(endpointId: string): Promise<void> {
  const [endpoint, recent] = await Promise.all([
    db.webhookEndpoint.findUnique({ where: { id: endpointId }, select: { status: true } }),
    db.webhookDelivery.findMany({
      where: { endpointId },
      orderBy: { at: "desc" },
      take: 20,
      select: { success: true },
    }),
  ]);
  if (!endpoint || recent.length === 0) return;
  const successes = recent.filter((d) => d.success).length;
  const last5 = recent.slice(0, 5);
  const streakFailing = last5.length === 5 && last5.every((d) => !d.success);
  let status: string | undefined;
  if (streakFailing) status = "FAILING";
  else if (endpoint.status === "FAILING") status = "ACTIVE"; // recovered
  await db.webhookEndpoint.update({
    where: { id: endpointId },
    data: {
      successRate: Math.round((successes / recent.length) * 100),
      lastDeliveryAt: new Date(),
      ...(status ? { status } : {}),
    },
  });
}

export type RetryResult = { retried: number; recovered: number; exhausted: number };

/**
 * Retry pass for the background worker: re-POST failed deliveries whose
 * backoff has come due, using the snapshotted payload (byte-identical, HMAC
 * stable). Attempts beyond the budget are closed out (nextAttemptAt = null).
 */
export async function retryFailedDeliveries(limit = 10): Promise<RetryResult> {
  const candidates = await db.webhookDelivery.findMany({
    where: {
      success: false,
      payload: { not: null },
      attempts: { lt: MAX_WEBHOOK_ATTEMPTS },
      nextAttemptAt: { lte: new Date() },
      endpoint: { status: { not: "PAUSED" } },
      OR: [{ claimUntil: null }, { claimUntil: { lt: new Date() } }],
    },
    include: { endpoint: true },
    orderBy: { at: "asc" },
    take: limit,
  });

  const out: RetryResult = { retried: 0, recovered: 0, exhausted: 0 };
  for (const candidate of candidates) {
    const claimToken = randomUUID();
    const claimed = await db.webhookDelivery.updateMany({
      where: { id: candidate.id, success: false, OR: [{ claimUntil: null }, { claimUntil: { lt: new Date() } }] },
      data: { claimToken, claimUntil: new Date(Date.now() + DELIVERY_LEASE_MS) },
    });
    if (claimed.count !== 1) continue;
    const d = await db.webhookDelivery.findUnique({ where: { id: candidate.id }, include: { endpoint: true } });
    if (!d || d.claimToken !== claimToken) continue;
    const attempt = d.attempts + 1;
    const headers: Record<string, string> = {
      "X-Docurama-Event": d.event,
      "X-Docurama-Delivery": d.id,
    };
    const signature = signPayload(d.endpoint.secret, d.payload!);
    if (signature) headers["X-Docurama-Signature"] = signature;

    const started = Date.now();
    let statusCode = 0;
    let success = false;
    try {
      const r = await postOnce(d.endpoint.url, d.payload!, headers);
      statusCode = r.statusCode;
      success = true;
    } catch (err) {
      statusCode = (err as { statusCode?: number }).statusCode ?? 0;
    }
    const terminalFail = !success && attempt >= MAX_WEBHOOK_ATTEMPTS;

    await db.webhookDelivery.update({
      where: { id: d.id },
      data: {
        success,
        statusCode,
        durationMs: Date.now() - started,
        attempts: attempt,
        nextAttemptAt:
          success || terminalFail ? null : new Date(Date.now() + webhookBackoffMs(attempt)),
        at: new Date(),
        claimToken: null,
        claimUntil: null,
      },
    });
    out.retried++;
    if (success) out.recovered++;
    if (terminalFail) out.exhausted++;
    await refreshEndpointHealth(d.endpointId);
  }
  return out;
}
