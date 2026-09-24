/// <reference types="bun-types" />

/**
 * Envelope email (src/lib/notify.ts, src/lib/email-templates.ts,
 * src/lib/reminders.ts, src/lib/mail.ts): the workspace's wording and logo,
 * sender alerts that honour Settings > Notifications, the signed copy every
 * recipient gets at completion, automated reminders, and delivery through a
 * workspace's own SMTP server (a local relay here) only once it passed a test.
 *
 * Hermetic: scratch SQLite schema, in-process signing route, loopback relay.
 * Its own process (run.sh): it points SMTP settings at a local relay.
 *
 * Run: bun test e2e/notifications.test.ts
 */

import { afterAll, describe, expect, test } from "bun:test";
import net from "node:net";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Database } from "bun:sqlite";
import { NextRequest } from "next/server";

const DIR = mkdtempSync(join(tmpdir(), "notify-e2e-"));
process.env.DATABASE_URL = `file:${join(DIR, "scratch.db").replace(/\\/g, "/")}`;
process.env.STORAGE_DIR = join(DIR, "storage").replace(/\\/g, "/");
for (const k of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT", "SMTP_URL", "EVIDENCE_PORTAL_URL"]) delete process.env[k];
process.env.REKOR_WITNESS = "off";
process.env.SEAL_TIMESTAMPS = "off";
new Database(join(DIR, "scratch.db"), { create: true }).close();
execFileSync("node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });

const db = new PrismaClient();
const signRoute = await import("../src/app/api/sign/[token]/route");
const logoRoute = await import("../src/app/api/branding/logo/[hash]/route");
const { queueInvitations } = await import("../src/lib/notify");
const { renderEmail } = await import("../src/lib/email-templates");
const { runReminderPass, reminderDecision } = await import("../src/lib/reminders");
const { processOutbox, vetSmtpHost } = await import("../src/lib/mail");

afterAll(async () => {
  relay.close();
  await db.$disconnect();
  await (await import("../src/lib/db")).db.$disconnect();
});

/* ── A local SMTP relay that records what it is handed ──────────────────────── */

type Captured = { mailFrom: string; to: string[]; data: string };
const captured: Captured[] = [];
const relay = net.createServer((socket) => {
  let inData = false;
  let buffer = "";
  let current: Captured = { mailFrom: "", to: [], data: "" };
  const send = (line: string) => socket.write(`${line}\r\n`);
  send("220 relay ESMTP");
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let i: number;
    while ((i = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      if (inData) {
        if (line === ".") { inData = false; captured.push(current); current = { mailFrom: "", to: [], data: "" }; send("250 queued"); }
        else current.data += (line.startsWith("..") ? line.slice(1) : line) + "\n";
        continue;
      }
      const cmd = line.toUpperCase();
      if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) socket.write("250-relay\r\n250 8BITMIME\r\n");
      else if (cmd.startsWith("MAIL FROM")) { current.mailFrom = /<([^>]*)>/.exec(line)?.[1] ?? ""; send("250 ok"); }
      else if (cmd.startsWith("RCPT TO")) { current.to.push(/<([^>]*)>/.exec(line)?.[1] ?? ""); send("250 ok"); }
      else if (cmd === "DATA") { inData = true; send("354 go"); }
      else if (cmd === "QUIT") { send("221 bye"); socket.end(); }
      else send("250 ok");
    }
  });
});
await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
const RELAY_PORT = (relay.address() as net.AddressInfo).port;

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const stamp = Date.now();
const tenant = await db.tenant.create({ data: { name: "StålFe AB", slug: `stalfe-notify-${stamp}`, planCode: "BUSINESS", status: "ACTIVE" } });
const sender = await db.user.create({
  data: { email: `alexandra.${stamp}@stalfe.example`, passwordHash: "fixture-not-a-credential", firstName: "Alexandra", lastName: "Fischer", role: "WORKSPACE_ADMIN", status: "ACTIVE" },
});
let seq = 0;

async function envelope(opts: { signers?: number; cc?: boolean; contractText?: string | null; createdAt?: Date } = {}) {
  const signers = opts.signers ?? 2;
  const people = [
    ...Array.from({ length: signers }, (_, i) => ({ name: ["Camille Laurent", "Marco Bianchi", "Léa Moreau"][i], email: `signer${i + 1}.${stamp}.${seq}@client.example`, role: "SIGNER" })),
    ...(opts.cc ? [{ name: "Jonas Weber", email: `cc.${stamp}.${seq}@client.example`, role: "CC" }] : []),
  ];
  const e = await db.envelope.create({
    data: {
      publicCode: `DOC-NT${String(++seq).padStart(4, "0")}${stamp % 1000}`, title: "Contrat <cadre> & annexe", titleLower: "contrat",
      tenantId: tenant.id, createdById: sender.id, status: "SENT", pages: 1, message: "Merci de signer avant vendredi.",
      contractText: opts.contractText === undefined ? "# Contrat\n\nLes parties conviennent de ce qui suit." : opts.contractText,
      createdAt: opts.createdAt,
      recipients: { create: people.map((p, i) => ({ ...p, order: i + 1, accessToken: randomBytes(24).toString("base64url") })) },
    },
    include: { recipients: { orderBy: { order: "asc" } } },
  });
  return e;
}

async function sign(token: string, name: string) {
  const res = await signRoute.POST(new NextRequest(`https://app.docurama.test/api/sign/${token}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "sign", name }),
  }), { params: Promise.resolve({ token }) });
  expect(res.status).toBe(200);
}

const outboxFor = (to: string) => db.mailOutbox.findMany({ where: { toEmail: to }, orderBy: { createdAt: "asc" } });

/* ── Wording and branding ──────────────────────────────────────────────────── */

describe("email templates", () => {
  test("the HTML version escapes every value, and the link is always there", () => {
    const r = renderEmail("invite", { "document.title": "<script>alert(1)</script>", "recipient.name": "Camille", link: "https://app.test/sign/abc" },
      { overrides: { invite: { subject: "Please sign {{document.title}}", body: "Bonjour {{recipient.name}}, merci de signer {{document.title}}." } } });
    expect(r.subject).toBe("Please sign <script>alert(1)</script>"); // subjects are plain text
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    // The custom body left the link out: it is appended, as text and as a button.
    expect(r.text).toContain("Bonjour Camille, merci de signer <script>alert(1)</script>.");
    expect(r.text).toContain("https://app.test/sign/abc");
    expect(r.html).toContain('href="https://app.test/sign/abc"');
  });

  test("invitations use the workspace's wording, logo and Reply-To", async () => {
    await db.personalization.create({ data: {
      tenantId: tenant.id, logo: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64")}`, logoSha256: "a".repeat(64),
      emailTemplates: JSON.stringify({ invite: { subject: "{{workspace.name}} : signature requise pour {{document.title}}", body: "Bonjour {{recipient.name}},\n\n{{message}}\n\n{{link}}" } }),
    } });
    const e = await envelope({ cc: true });
    await queueInvitations(db, { tenantId: tenant.id, publicCode: e.publicCode, title: e.title, message: e.message, createdBy: sender },
      e.recipients.map((r) => ({ ...r, accessToken: r.accessToken! })), { origin: "https://app.docurama.test" });
    const [invite] = await outboxFor(e.recipients[0].email);
    expect(invite).toMatchObject({ template: "SIGN_INVITE", subject: "StålFe AB : signature requise pour Contrat <cadre> & annexe", replyTo: sender.email, tenantId: tenant.id });
    expect(invite.bodyText).toContain("Merci de signer avant vendredi.");
    expect(invite.linkUrl).toBe(`https://app.docurama.test/sign/${e.recipients[0].accessToken}`);
    expect(invite.bodyHtml).toContain(`https://app.docurama.test/api/branding/logo/${"a".repeat(64)}`);
    // Copy recipients get a notice, never a signing link.
    const [cc] = await outboxFor(e.recipients[2].email);
    expect(cc).toMatchObject({ template: "COPY_NOTICE", linkUrl: null });
    // "Sent" confirmations are off unless the sender turns them on.
    expect(await db.mailOutbox.count({ where: { toEmail: sender.email, template: "SENT_NOTICE" } })).toBe(0);
  });

  test("the logo is served publicly by its fingerprint, cacheable for good", async () => {
    const ok = await logoRoute.GET(new NextRequest("https://app.docurama.test/"), { params: Promise.resolve({ hash: "a".repeat(64) }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("cache-control")).toContain("immutable");
    const missing = await logoRoute.GET(new NextRequest("https://app.docurama.test/"), { params: Promise.resolve({ hash: "b".repeat(64) }) });
    expect(missing.status).toBe(404);
  });
});

/* ── Signing progress and completion ───────────────────────────────────────── */

describe("sender alerts and signed copies", () => {
  test("each signature alerts the sender; completion sends the notice and everyone's signed copy", async () => {
    const e = await envelope({ cc: true });
    await sign(e.recipients[0].accessToken!, "Camille Laurent");
    const signed = await db.mailOutbox.findMany({ where: { toEmail: sender.email, template: "SIGNED_NOTICE" } });
    expect(signed.length).toBe(1);
    expect(signed[0].subject).toBe("Camille Laurent signed Contrat <cadre> & annexe");
    expect(signed[0].linkUrl).toBe(`https://app.docurama.test/documents?code=${e.publicCode}`);

    await sign(e.recipients[1].accessToken!, "Marco Bianchi");
    expect((await db.envelope.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("COMPLETED");
    const completed = await db.mailOutbox.findMany({ where: { toEmail: sender.email, template: "COMPLETED_NOTICE", subject: { contains: e.title } } });
    expect(completed.length).toBe(1);
    // Signers and the copy recipient: their own download link, replies to the sender.
    for (const r of e.recipients) {
      const copies = (await outboxFor(r.email)).filter((m) => m.template === "DOCUMENT_COPY");
      expect(copies.length).toBe(1);
      expect(copies[0]).toMatchObject({ linkUrl: `https://app.docurama.test/api/sign/${r.accessToken}/signed-pdf`, replyTo: sender.email });
      expect(copies[0].bodyText).toContain(e.publicCode);
    }
  });

  test("the workspace's alert settings are honoured; declines always reach the sender by default", async () => {
    await db.notificationSettings.create({ data: { tenantId: tenant.id, alertOnSigned: false, alertOnCompleted: false, alertOnDeclined: true } });
    const e = await envelope();
    const before = await db.mailOutbox.count({ where: { toEmail: sender.email } });
    await sign(e.recipients[0].accessToken!, "Camille Laurent");
    expect(await db.mailOutbox.count({ where: { toEmail: sender.email } })).toBe(before);
    const res = await signRoute.POST(new NextRequest(`https://app.docurama.test/api/sign/${e.recipients[1].accessToken}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "decline", reason: "Clause 4 to revise" }),
    }), { params: Promise.resolve({ token: e.recipients[1].accessToken! }) });
    expect(res.status).toBe(200);
    const [declined] = await db.mailOutbox.findMany({ where: { toEmail: sender.email, template: "DECLINED_NOTICE" }, orderBy: { createdAt: "desc" }, take: 1 });
    expect(declined.subject).toBe("Marco Bianchi declined to sign Contrat <cadre> & annexe");
    expect(declined.bodyText).toContain("Clause 4 to revise");
  });
});

/* ── Automated reminders ───────────────────────────────────────────────────── */

describe("automated reminders", () => {
  // A Tuesday, 10:00 in Paris: inside working hours.
  const tuesday = new Date("2026-09-22T08:00:00Z");

  test("the policy: interval, maximum, weekends and quiet hours (Europe/Paris)", () => {
    const policy = { reminderMode: "platform_job", reminderIntervalDays: 3, reminderMaxCount: 2, quietHoursStart: "21:00", quietHoursEnd: "08:00", skipWeekends: true };
    const sent = { autoRemind: false, reminderCount: 0, lastRemindedAt: null, createdAt: new Date("2026-09-18T08:00:00Z") };
    expect(reminderDecision(policy, sent, tuesday).due).toBe(true);
    expect(reminderDecision({ ...policy, reminderMode: "manual" }, sent, tuesday)).toEqual({ due: false, skip: "manual" });
    expect(reminderDecision({ ...policy, reminderMode: "manual" }, { ...sent, autoRemind: true }, tuesday).due).toBe(true);
    expect(reminderDecision(policy, { ...sent, reminderCount: 2 }, tuesday)).toEqual({ due: false, skip: "max" });
    expect(reminderDecision(policy, { ...sent, createdAt: new Date("2026-09-21T08:00:00Z") }, tuesday)).toEqual({ due: false, skip: "throttle" });
    expect(reminderDecision(policy, sent, new Date("2026-09-26T10:00:00Z"))).toEqual({ due: false, skip: "weekend" }); // Saturday
    expect(reminderDecision(policy, sent, new Date("2026-09-22T20:30:00Z"))).toEqual({ due: false, skip: "quiet" }); // 22:30 Paris
  });

  test("the worker reminds only the signer whose turn it is, once per interval, even with two workers", async () => {
    await db.notificationSettings.update({ where: { tenantId: tenant.id }, data: { reminderMode: "platform_job", reminderIntervalDays: 3, reminderMaxCount: 5 } });
    const e = await envelope({ createdAt: new Date("2026-09-15T08:00:00Z") });
    const [first, second] = await Promise.all([runReminderPass({ now: tuesday }), runReminderPass({ now: tuesday })]);
    expect(first.reminded + second.reminded).toBeGreaterThanOrEqual(1);
    const reminders = await db.mailOutbox.findMany({ where: { template: "REMINDER", toEmail: { in: e.recipients.map((r) => r.email) } } });
    expect(reminders.map((m) => m.toEmail)).toEqual([e.recipients[0].email]);
    expect(reminders[0].linkUrl).toContain(`/sign/${e.recipients[0].accessToken}`);
    const after = await db.envelope.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.reminderCount).toBe(1);
    expect(await db.envelopeEvent.count({ where: { envelopeId: e.id, action: "REMINDED" } })).toBe(1);
    // A day later: within the interval, nothing more.
    await runReminderPass({ now: new Date(tuesday.getTime() + 86_400_000) });
    expect(await db.mailOutbox.count({ where: { template: "REMINDER", toEmail: e.recipients[0].email } })).toBe(1);
  });
});

/* ── Delivery through the workspace's own SMTP ─────────────────────────────── */

describe("workspace SMTP", () => {
  test("hosts in the private network and odd ports are refused outside development", async () => {
    const previous = process.env.DOCURAMA_ALLOW_PRIVATE_WEBHOOKS;
    delete process.env.DOCURAMA_ALLOW_PRIVATE_WEBHOOKS;
    try {
      for (const [host, port] of [["10.0.0.5", 587], ["127.0.0.1", 25], ["mail.internal", 587], ["169.254.169.254", 465], ["localhost", 587]] as const) {
        await expect(vetSmtpHost(host, port)).rejects.toThrow();
      }
      await expect(vetSmtpHost("93.184.216.34", 2526)).rejects.toThrow(/port 2526/);
    } finally {
      if (previous !== undefined) process.env.DOCURAMA_ALLOW_PRIVATE_WEBHOOKS = previous;
    }
  });

  test("mail goes through the workspace relay, from its address, only once a test passed", async () => {
    process.env.DOCURAMA_ALLOW_PRIVATE_WEBHOOKS = "1"; // the relay is on loopback (non-production only)
    await db.notificationSettings.update({ where: { tenantId: tenant.id }, data: {
      smtpHost: "127.0.0.1", smtpPort: RELAY_PORT, smtpUser: null, smtpPassword: null, smtpSecure: false,
      smtpFrom: "Contrats StålFe <contrats@stalfe.example>", smtpLastTestStatus: null,
    } });
    // Everything queued so far is StålFe's mail; with no platform relay and an untested
    // workspace relay, nothing is sent.
    const untested = await processOutbox(100);
    expect(untested).toMatchObject({ mode: "outbox-only", sent: 0 });

    await db.notificationSettings.update({ where: { tenantId: tenant.id }, data: { smtpLastTestStatus: "OK" } });
    const queued = await db.mailOutbox.count({ where: { tenantId: tenant.id, status: "QUEUED" } });
    const result = await processOutbox(100);
    expect(result.sent).toBe(queued);
    expect(captured.length).toBe(queued);
    const inviteRow = await db.mailOutbox.findFirstOrThrow({ where: { tenantId: tenant.id, template: "SIGN_INVITE" } });
    const invite = captured.find((c) => c.to.includes(inviteRow.toEmail))!;
    expect(invite.mailFrom).toBe("contrats@stalfe.example");
    expect(invite.data).toMatch(/^Reply-To: .*alexandra\./m);
    expect(invite.data).toContain("Content-Type: text/html");
    expect(await db.mailOutbox.count({ where: { tenantId: tenant.id, status: "SENT" } })).toBe(queued);
  });
});
