/**
 * Envelope email: invitations, reminders, sender alerts and signed copies.
 *
 * Every message is rendered with the workspace's Personalization (wording,
 * logo) and written to the mail outbox in the caller's transaction, next to
 * the ledger event it announces; the worker delivers it through the
 * workspace's own SMTP when one is configured (src/lib/mail.ts).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { publicVerifyUrl } from "@/lib/app-origin";
import { parseEmailOverrides, renderEmail, type EmailKind, type EmailVars } from "@/lib/email-templates";

type Client = Prisma.TransactionClient | typeof db;

export const OUTBOX_TEMPLATE: Record<EmailKind, string> = {
  invite: "SIGN_INVITE", reminder: "REMINDER", completed: "COMPLETED_NOTICE", copy: "DOCUMENT_COPY",
  cc: "COPY_NOTICE", signed: "SIGNED_NOTICE", viewed: "VIEWED_NOTICE", declined: "DECLINED_NOTICE", sent: "SENT_NOTICE",
};

export type OutgoingEmail = { kind: EmailKind; to: string; link?: string | null; vars: EmailVars };

/** Queue envelope emails in `client` (a transaction, so they commit with the event they announce). */
export async function queueEnvelopeEmails(client: Client, input: {
  tenantId: string; origin: string; replyTo?: string | null; createdAt?: Date; emails: OutgoingEmail[];
}): Promise<number> {
  if (!input.emails.length) return 0;
  const [tenant, look] = await Promise.all([
    client.tenant.findUnique({ where: { id: input.tenantId }, select: { name: true } }),
    client.personalization.findUnique({ where: { tenantId: input.tenantId }, select: { emailTemplates: true, logoSha256: true } }),
  ]);
  const workspace = tenant?.name ?? "Docurama";
  const overrides = parseEmailOverrides(look?.emailTemplates);
  const logoUrl = look?.logoSha256 ? `${input.origin}/api/branding/logo/${look.logoSha256}` : null;
  const data = input.emails.map((email) => {
    const rendered = renderEmail(email.kind, { "workspace.name": workspace, ...email.vars, ...(email.link ? { link: email.link } : {}) },
      { overrides, logoUrl, brandName: workspace });
    return {
      toEmail: email.to, template: OUTBOX_TEMPLATE[email.kind], subject: rendered.subject,
      bodyText: rendered.text, bodyHtml: rendered.html, linkUrl: email.link ?? null,
      replyTo: input.replyTo ?? null, tenantId: input.tenantId,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    };
  });
  await client.mailOutbox.createMany({ data });
  return data.length;
}

export type SenderAlert = "sent" | "viewed" | "signed" | "completed" | "declined";

/** Workspace Notifications settings; a workspace that never opened them gets the useful defaults. */
export async function senderAlertOn(client: Client, tenantId: string, alert: SenderAlert): Promise<boolean> {
  const n = await client.notificationSettings.findUnique({ where: { tenantId } });
  if (!n) return alert === "signed" || alert === "completed" || alert === "declined";
  return { sent: n.alertOnSent, viewed: n.alertOnViewed, signed: n.alertOnSigned, completed: n.alertOnCompleted, declined: n.alertOnDeclined }[alert];
}

type EnvelopeRef = { tenantId: string; publicCode: string; title: string; message?: string | null; createdBy: { email: string; firstName?: string | null; lastName?: string | null } };

export const senderName = (u: EnvelopeRef["createdBy"]) => [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email;

/** Variables every envelope email shares. */
export function envelopeVars(envelope: EnvelopeRef): EmailVars {
  return {
    "sender.name": senderName(envelope.createdBy), "sender.email": envelope.createdBy.email,
    "document.title": envelope.title, "document.code": envelope.publicCode,
    "message": envelope.message?.trim() || "", "verify.link": publicVerifyUrl(envelope.publicCode),
  };
}

/** Tell the sender, if their workspace wants this alert. */
export async function queueSenderAlert(client: Client, envelope: EnvelopeRef, alert: SenderAlert, input: {
  origin: string; createdAt?: Date; signerName?: string; reason?: string;
}): Promise<void> {
  if (!(await senderAlertOn(client, envelope.tenantId, alert))) return;
  await queueEnvelopeEmails(client, {
    tenantId: envelope.tenantId, origin: input.origin, createdAt: input.createdAt,
    emails: [{
      kind: alert, to: envelope.createdBy.email,
      link: `${input.origin}/documents?code=${encodeURIComponent(envelope.publicCode)}`,
      vars: {
        ...envelopeVars(envelope), "recipient.name": senderName(envelope.createdBy), "recipient.email": envelope.createdBy.email,
        "signer.name": input.signerName ?? "", "reason": input.reason ?? "",
      },
    }],
  });
}

/**
 * Invitations for a freshly sent envelope: signers get their signing link,
 * copy recipients a notice; replies go to the sender.
 */
export async function queueInvitations(client: Client, envelope: EnvelopeRef, recipients: { name: string; email: string; role: string; accessToken: string }[], input: {
  origin: string; createdAt?: Date;
}): Promise<void> {
  const base = envelopeVars(envelope);
  await queueEnvelopeEmails(client, {
    tenantId: envelope.tenantId, origin: input.origin, createdAt: input.createdAt, replyTo: envelope.createdBy.email,
    emails: recipients.map((r) => ({
      kind: r.role === "SIGNER" ? "invite" as const : "cc" as const, to: r.email,
      link: r.role === "SIGNER" ? `${input.origin}/sign/${r.accessToken}` : null,
      vars: { ...base, "recipient.name": r.name, "recipient.email": r.email },
    })),
  });
  await queueSenderAlert(client, envelope, "sent", input);
}

/** Reminders to the given signers (their personal links). */
export async function queueReminders(client: Client, envelope: EnvelopeRef, signers: { name: string; email: string; accessToken: string | null }[], input: {
  origin: string; createdAt?: Date;
}): Promise<number> {
  const base = envelopeVars(envelope);
  return queueEnvelopeEmails(client, {
    tenantId: envelope.tenantId, origin: input.origin, createdAt: input.createdAt, replyTo: envelope.createdBy.email,
    emails: signers.filter((s) => s.accessToken).map((s) => ({
      kind: "reminder" as const, to: s.email, link: `${input.origin}/sign/${s.accessToken}`,
      vars: { ...base, "recipient.name": s.name, "recipient.email": s.email },
    })),
  });
}

/**
 * Completion: the sender's notice (if enabled) and every recipient's signed
 * copy, each with their own download link.
 */
export async function queueCompletion(client: Client, envelope: EnvelopeRef, recipients: { name: string; email: string; accessToken: string | null }[], input: {
  origin: string; createdAt?: Date; hasPdf: boolean;
}): Promise<void> {
  const base = envelopeVars(envelope);
  if (await senderAlertOn(client, envelope.tenantId, "completed")) {
    await queueEnvelopeEmails(client, {
      tenantId: envelope.tenantId, origin: input.origin, createdAt: input.createdAt,
      emails: [{
        kind: "completed", to: envelope.createdBy.email,
        link: `${input.origin}/documents?code=${encodeURIComponent(envelope.publicCode)}`,
        vars: { ...base, "recipient.name": senderName(envelope.createdBy), "recipient.email": envelope.createdBy.email },
      }],
    });
  }
  await queueEnvelopeEmails(client, {
    tenantId: envelope.tenantId, origin: input.origin, createdAt: input.createdAt, replyTo: envelope.createdBy.email,
    emails: recipients.filter((r) => r.accessToken).map((r) => ({
      kind: "copy" as const, to: r.email,
      // No document to download (an envelope without a PDF): the public verification page instead.
      link: input.hasPdf ? `${input.origin}/api/sign/${r.accessToken}/signed-pdf` : publicVerifyUrl(envelope.publicCode),
      vars: { ...base, "recipient.name": r.name, "recipient.email": r.email },
    })),
  });
}
