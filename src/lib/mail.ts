/**
 * Outbound mail transport (nodemailer over SMTP_URL).
 *
 * Deployment contract: set SMTP_URL to a credentials-bearing connection string
 * (smtps://user:pass@smtp.eu.mailprovider.io:465 or smtp://user:pass@host:587)
 * and every transactional message recorded in the MailOutbox ledger is
 * delivered for real. Without SMTP_URL the platform stays in honest queue
 * mode: messages are recorded as QUEUED, inspectable in the admin console and
 * never silently dropped or claimed as sent.
 *
 * Storage of document blobs is a separate concern — see docs/STORAGE-OPTIONS.md
 * for the S3-compatible backend comparison (SeaweedFS vs MinIO vs Garage).
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { db } from "@/lib/db";

/** True when a real SMTP transport is configured for this deployment. */
export const SMTP_TRANSPORT_CONFIGURED = Boolean(process.env.SMTP_URL);

let cached: Transporter | null = null;

function transport(): Transporter | null {
  const url = process.env.SMTP_URL;
  if (!url) return null;
  if (!cached) {
    // The connection string carries host/port/TLS/credentials; nodemailer
    // pools connections opportunistically once warmed.
    cached = nodemailer.createTransport(url);
  }
  return cached;
}

export interface DeliveryReport {
  attempted: number;
  sent: number;
  failed: number;
  skipped: boolean;
}

/**
 * Attempt real delivery for the oldest QUEUED outbox rows. Failures are marked
 * FAILED (visible in the admin mail console) and can be requeued with
 * `requeueFailedMail()`. Returns a report for the audit log.
 */
export async function flushMailOutbox(limit = 25): Promise<DeliveryReport> {
  const tx = transport();
  if (!tx) return { attempted: 0, sent: 0, failed: 0, skipped: true };
  const queued = await db.mailOutbox.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let sent = 0;
  let failed = 0;
  for (const m of queued) {
    try {
      await tx.sendMail({
        from: m.fromEmail,
        to: m.toEmail,
        subject: m.subject,
        text: m.bodyText,
      });
      await db.mailOutbox.update({ where: { id: m.id }, data: { status: "SENT", sentAt: new Date() } });
      sent += 1;
    } catch (err) {
      await db.mailOutbox.update({ where: { id: m.id }, data: { status: "FAILED" } });
      failed += 1;
      console.error(`[mail] delivery to ${m.toEmail} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return { attempted: queued.length, sent, failed, skipped: false };
}

/** Flip FAILED rows back to QUEUED for another delivery attempt. */
export async function requeueFailedMail(limit = 100): Promise<number> {
  const res = await db.mailOutbox.updateMany({
    where: { status: "FAILED" },
    data: { status: "QUEUED" },
  });
  void limit;
  return res.count;
}

/**
 * Fire-and-forget delivery attempt after a message is queued (signing
 * invitations, verifications, reminders). Never throws into the caller: a
 * transport hiccup leaves the row QUEUED for the next admin flush.
 */
export async function tryDeliverSoon(): Promise<void> {
  try {
    await flushMailOutbox(5);
  } catch (err) {
    console.error("[mail] opportunistic flush failed:", err instanceof Error ? err.message : err);
  }
}
