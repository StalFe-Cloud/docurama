import { createTransport } from "nodemailer";
import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import { db } from "@/lib/db";
import { openSecret } from "@/lib/key-vault";
import { isPublicAddress } from "@/lib/safe-webhook-http";

export const MAX_MAIL_ATTEMPTS = 10;
const MAIL_LEASE_MS = 90_000;
const SEND_DEADLINE_MS = 30_000;

export const GENERAL_BACKOFF_MS = [
  30_000,      // attempt 1: 30s
  120_000,     // attempt 2: 2m
  480_000,     // attempt 3: 8m
  1_800_000,   // attempt 4: 30m
  3_600_000,   // attempt 5: 1h
  7_200_000,   // attempt 6: 2h
  14_400_000,  // attempt 7: 4h
  21_600_000,  // attempt 8: 6h
  28_800_000,  // attempt 9: 8h
  43_200_000,  // attempt 10: 12h
];

export const RATE_LIMIT_BACKOFF_MS = [
  3_600_000,   // attempt 1: 1h
  7_200_000,   // attempt 2: 2h
  14_400_000,  // attempt 3: 4h
  28_800_000,  // attempt 4: 8h
  43_200_000,  // attempt 5: 12h
  86_400_000,  // attempt 6+: 24h
];

export function isRateLimitError(err?: string | null): boolean {
  if (!err) return false;
  return /45[0-2]|rate|quota|too many|limit|exceeded|try again later/i.test(err);
}

export function mailBackoffMs(attempt: number, lastError?: string | null): number {
  if (isRateLimitError(lastError)) {
    const idx = Math.max(0, Math.min(attempt - 1, RATE_LIMIT_BACKOFF_MS.length - 1));
    return RATE_LIMIT_BACKOFF_MS[idx];
  }
  const idx = Math.max(0, Math.min(attempt - 1, GENERAL_BACKOFF_MS.length - 1));
  return GENERAL_BACKOFF_MS[idx];
}
export type SmtpMode = { configured: true; url: URL; tls: boolean } | { configured: false };
export function smtpMode(): SmtpMode {
  const raw = process.env.SMTP_URL?.trim();
  if (!raw) return { configured: false };
  try {
    const url = new URL(raw);
    if (!["smtp:", "smtps:"].includes(url.protocol)) return { configured: false };
    return { configured: true, url, tls: url.searchParams.get("tls") !== "off" };
  } catch {
    console.warn("[mail] Invalid SMTP_URL; messages remain in the outbox");
    return { configured: false };
  }
}

/** Resolves SMTP mode from process.env.SMTP_URL or falls back to database PlatformSetting. */
export async function resolveSmtpMode(): Promise<SmtpMode> {
  const envMode = smtpMode();
  if (envMode.configured) return envMode;
  try {
    const setting = await db.platformSetting.findUnique({ where: { id: "singleton" } });
    if (setting?.smtpHost && setting.smtpHost !== "smtp.eu.mailprovider.io" && setting.smtpPassword) {
      const proto = setting.smtpPort === 465 ? "smtps:" : "smtp:";
      const auth = setting.smtpUser ? `${encodeURIComponent(setting.smtpUser)}:${encodeURIComponent(setting.smtpPassword)}@` : "";
      const url = new URL(`${proto}//${auth}${setting.smtpHost}:${setting.smtpPort}`);
      return { configured: true, url, tls: setting.smtpTls };
    }
  } catch {
    // Database query failed or table not yet migrated
  }
  return { configured: false };
}

/** Explicit SMTP verification and optional test email dispatch for admin UI testing. */
export async function testSmtpConnection(opts: {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  tls?: boolean;
  from: string;
  to?: string;
  /** Pinned, already-vetted address to connect to (workspace SMTP); TLS still checks `host`. */
  address?: string;
}): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const t0 = Date.now();
  const secure = opts.port === 465;
  const transporter = createTransport({
    host: opts.address ?? opts.host,
    ...(opts.address ? { tls: { servername: opts.host } } : {}),
    port: opts.port,
    secure,
    requireTLS: opts.tls && !secure,
    ignoreTLS: !opts.tls,
    auth: opts.user ? { user: opts.user, pass: opts.pass ?? "" } : undefined,
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 10_000,
    pool: false,
  });

  try {
    await transporter.verify();
    if (opts.to) {
      await transporter.sendMail({
        from: opts.from,
        to: opts.to,
        subject: "Docurama Sign - SMTP Test Message",
        text: `This is an automated test message from Docurama Sign to confirm SMTP connectivity.\n\nTimestamp: ${new Date().toISOString()}\nHost: ${opts.host}:${opts.port}`,
      });
    }
    const latencyMs = Date.now() - t0;
    return { ok: true, message: `SMTP connection verified (${latencyMs}ms)${opts.to ? ` - test email sent to ${opts.to}` : ""}`, latencyMs };
  } catch (err: any) {
    const latencyMs = Date.now() - t0;
    return { ok: false, message: `SMTP verification failed: ${err.message || String(err)}`, latencyMs };
  } finally {
    transporter.close();
  }
}

export type OutboxMessage = {
  id: string; toEmail: string; fromEmail: string; subject: string; bodyText: string;
  bodyHtml?: string | null; replyTo?: string | null;
};

/* ── Workspace SMTP (Settings > Notifications) ─────────────────────────────── */

const SMTP_PORTS = new Set([25, 465, 587, 2525]);

/** Stored workspace SMTP passwords: encrypted (gcm1:/plain:, src/lib/key-vault.ts) or, from before, raw. */
export function readSmtpSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  return /^(gcm1|plain):/.test(stored) ? openSecret(stored) : stored;
}

/**
 * A workspace SMTP host is chosen by a workspace admin, so the worker must not
 * be steered into the private network: submission ports only, and a hostname
 * that resolves exclusively to public addresses. Returns the address to pin
 * the connection to (no second lookup to rebind).
 */
export async function vetSmtpHost(host: string, port: number): Promise<string> {
  const hostname = host.toLowerCase().replace(/\.$/, "");
  const development = process.env.NODE_ENV !== "production" && process.env.DOCURAMA_ALLOW_PRIVATE_WEBHOOKS === "1";
  if (!SMTP_PORTS.has(port) && !development) throw new Error(`SMTP port ${port} is not allowed (use 25, 465, 587 or 2525)`);
  if (!development && ((!hostname.includes(".") && !isIP(hostname)) || /(?:^|\.)(?:localhost|local|internal)$/.test(hostname))) {
    throw new Error("Internal SMTP hostnames are not allowed");
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error(`${hostname} does not resolve`);
  if (!development && addresses.some((a) => !isPublicAddress(a.address))) throw new Error("The SMTP host must resolve only to public addresses");
  return addresses[0].address;
}

export type WorkspaceSmtp = { mode: Extract<SmtpMode, { configured: true }>; from: string };

/** The workspace's own relay, when it has one that passed its test. */
export async function workspaceSmtp(tenantId: string): Promise<WorkspaceSmtp | null> {
  const n = await db.notificationSettings.findUnique({ where: { tenantId } });
  if (!n?.smtpHost || n.smtpLastTestStatus !== "OK") return null;
  const secure = n.smtpPort === 465;
  const pass = readSmtpSecret(n.smtpPassword) ?? "";
  const auth = n.smtpUser ? `${encodeURIComponent(n.smtpUser)}:${encodeURIComponent(pass)}@` : "";
  const url = new URL(`${secure ? "smtps:" : "smtp:"}//${auth}${n.smtpHost}:${n.smtpPort}`);
  return { mode: { configured: true, url, tls: n.smtpSecure }, from: n.smtpFrom };
}

/** A dedicated transport lets a deadline close only this message's connection. */
export async function sendViaSmtp(mode: Extract<SmtpMode, { configured: true }>, msg: OutboxMessage, opts: { address?: string } = {}): Promise<void> {
  const secure = mode.url.protocol === "smtps:";
  const transporter = createTransport({
    host: opts.address ?? mode.url.hostname, ...(opts.address ? { tls: { servername: mode.url.hostname } } : {}),
    port: Number(mode.url.port || (secure ? 465 : 587)),
    secure, requireTLS: mode.tls && !secure, ignoreTLS: !mode.tls,
    auth: mode.url.username ? { user: decodeURIComponent(mode.url.username), pass: decodeURIComponent(mode.url.password) } : undefined,
    connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 15_000,
    pool: false,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      transporter.sendMail({ from: msg.fromEmail, to: msg.toEmail, subject: msg.subject, text: msg.bodyText,
        ...(msg.bodyHtml ? { html: msg.bodyHtml } : {}), ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
        messageId: `<${msg.id}@outbox.docurama>` }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { transporter.close(); reject(new Error("SMTP delivery deadline exceeded")); }, SEND_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    transporter.close();
  }
}

export type ProcessOutboxResult = { mode: "smtp" | "outbox-only"; processed: number; sent: number; failed: number; deferred: number };
/** At least once. A crash after SMTP accepts but before acknowledgement may retry. */
export async function processOutbox(limit = 20): Promise<ProcessOutboxResult> {
  const mode = await resolveSmtpMode();
  // Workspaces with their own relay send even when the platform has none. A
  // relay is only used once its settings passed a test (Settings > Notifications).
  const ownRelay = (await db.notificationSettings.findMany({ where: { smtpHost: { not: null }, smtpLastTestStatus: "OK" }, select: { tenantId: true } })).map((n) => n.tenantId);
  if (!mode.configured && !ownRelay.length) return { mode: "outbox-only", processed: 0, sent: 0, failed: 0, deferred: 0 };
  const now = new Date();
  const unclaimed = { OR: [{ claimUntil: null }, { claimUntil: { lte: now } }] };
  await db.mailOutbox.updateMany({ where: { status: "QUEUED", attempts: { gte: MAX_MAIL_ATTEMPTS }, ...unclaimed },
    data: { status: "FAILED", nextAttemptAt: null, claimToken: null, claimUntil: null, lastError: "Attempt budget exhausted; last acknowledgement unavailable" } });
  const due = { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] };
  const candidates = await db.mailOutbox.findMany({ where: {
    status: "QUEUED", attempts: { lt: MAX_MAIL_ATTEMPTS }, AND: [due, unclaimed],
    ...(mode.configured ? {} : { tenantId: { in: ownRelay } }),
  }, orderBy: { createdAt: "asc" }, take: Math.max(0, Math.min(limit, 100)) });
  const relays = new Map<string, WorkspaceSmtp | null>();
  const result: ProcessOutboxResult = { mode: "smtp", processed: 0, sent: 0, failed: 0, deferred: 0 };
  for (const row of candidates) {
    const claimToken = randomUUID();
    const claimedAt = new Date();
    const claimed = await db.mailOutbox.updateMany({ where: {
      id: row.id, status: "QUEUED", attempts: row.attempts,
      AND: [
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: claimedAt } }] },
        { OR: [{ claimUntil: null }, { claimUntil: { lte: claimedAt } }] },
      ],
    }, data: { claimToken, claimUntil: new Date(Date.now() + MAIL_LEASE_MS), attempts: { increment: 1 } } });
    if (claimed.count !== 1) continue;
    result.processed++;
    const attempt = row.attempts + 1;
    let lastError: string | null = null;
    try {
      // The workspace's relay, from its own address, when it has one; else the platform's.
      let relay: WorkspaceSmtp | null = null;
      if (row.tenantId && ownRelay.includes(row.tenantId)) {
        if (!relays.has(row.tenantId)) relays.set(row.tenantId, await workspaceSmtp(row.tenantId));
        relay = relays.get(row.tenantId) ?? null;
      }
      if (relay) {
        const address = await vetSmtpHost(relay.mode.url.hostname, Number(relay.mode.url.port));
        await sendViaSmtp(relay.mode, { ...row, fromEmail: relay.from }, { address });
      } else if (mode.configured) {
        await sendViaSmtp(mode, row);
      } else {
        throw new Error("No SMTP relay configured");
      }
    } catch (error) {
      lastError = (error instanceof Error ? error.message : "SMTP delivery failed").slice(0, 500);
    }
    const success = lastError === null;
    const terminal = !success && attempt >= MAX_MAIL_ATTEMPTS;
    const acknowledged = await db.mailOutbox.updateMany({ where: { id: row.id, claimToken, status: "QUEUED" }, data: {
      status: success ? "SENT" : terminal ? "FAILED" : "QUEUED",
      sentAt: success ? new Date() : null, lastError,
      nextAttemptAt: success || terminal ? null : new Date(Date.now() + mailBackoffMs(attempt, lastError)),
      claimToken: null, claimUntil: null,
    } });
    if (acknowledged.count !== 1) continue;
    if (success) result.sent++;
    else if (terminal) result.failed++;
    else result.deferred++;
  }
  return result;
}

export async function outboxStats() {
  const [queued, failed, oldestQueued] = await Promise.all([
    db.mailOutbox.count({ where: { status: "QUEUED" } }),
    db.mailOutbox.count({ where: { status: "FAILED" } }),
    db.mailOutbox.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  return { queued, failed, oldestQueuedAt: oldestQueued?.createdAt.toISOString() ?? null };
}
