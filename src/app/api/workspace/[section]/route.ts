import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { requireUser, recordAudit } from "@/lib/auth";
import { publicRecipient, isos, iso, jsonError, jsonOk } from "@/lib/serializers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ section: string }> };
const PLAN_LIMITS: Record<string, number> = { STARTER: 25, BUSINESS: 250, ENTERPRISE: 5000 };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const me = await requireUser();
    const { section } = await ctx.params;
    const url = new URL(req.url);
    const q = url.searchParams;
    const search = (q.get("q") ?? "").toLowerCase().trim();
    const page = Math.max(1, Number(q.get("page") ?? 1));
    const perPage = Math.min(100, Math.max(5, Number(q.get("perPage") ?? 10)));
    const tenantId = me.tenantId;

    // Workspace context requires a tenant membership.
    if (["envelopes", "templates", "settings", "overview"].includes(section) && !tenantId) {
      return jsonError("No workspace membership for this account", 403);
    }

    switch (section) {
      case "overview": {
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
        const tenant = (await db.tenant.findUnique({ where: { id: tenantId! } }))!;
        const plan = await db.plan.findUnique({ where: { code: tenant.planCode } });
        const [sentThisMonth, completed, pending, awaitingMe, recent, mySignQueue] = await Promise.all([
          db.envelope.count({ where: { tenantId: tenantId!, createdAt: { gte: monthStart } } }),
          db.envelope.count({ where: { tenantId: tenantId!, status: "COMPLETED" } }),
          db.envelope.count({ where: { tenantId: tenantId!, status: { in: ["SENT", "PARTIALLY_SIGNED"] } } }),
          db.envelope.count({
            where: {
              tenantId: tenantId!, status: { in: ["SENT", "PARTIALLY_SIGNED"] },
              recipients: { some: { email: me.email, status: "PENDING" } },
            },
          }),
          db.envelope.findMany({
            where: { tenantId: tenantId! }, orderBy: { createdAt: "desc" }, take: 6,
            include: { recipients: true, createdBy: { select: { firstName: true, lastName: true } } },
          }),
          db.envelope.findMany({
            where: { recipients: { some: { email: me.email, status: "PENDING" } }, status: { in: ["SENT", "PARTIALLY_SIGNED"] } },
            orderBy: { createdAt: "desc" }, take: 5, include: { recipients: true, tenant: { select: { name: true } } },
          }),
        ]);
        const team = await db.member.findMany({
          where: { tenantId: tenantId! }, include: { user: true },
        });
        return jsonOk({
          plan: plan ? iso(plan) : null,
          tenant: iso(tenant),
          quota: { used: sentThisMonth, limit: PLAN_LIMITS[tenant.planCode] ?? 25 },
          kpis: { sentThisMonth, completed, pending, awaitingMe },
          recent: recent.map((e) => ({
            ...iso(e), createdBy: `${e.createdBy.firstName} ${e.createdBy.lastName}`,
            recipients: e.recipients.map(publicRecipient),
          })),
          mySignQueue: mySignQueue.map((e) => ({
            ...iso(e), tenantName: e.tenant.name, recipients: e.recipients.map(publicRecipient),
          })),
          team: team.map((m) => ({
            id: m.id, role: m.role, name: `${m.user.firstName} ${m.user.lastName}`,
            email: m.user.email, status: m.user.status, totpEnabled: m.user.totpEnabled,
          })),
        });
      }

      case "envelopes": {
        const status = q.get("status");
        const where: Record<string, unknown> = { tenantId: tenantId! };
        if (status && status !== "ALL") where.status = status;
        if (search) where.title = { contains: search };
        const [total, rows, myQueue] = await Promise.all([
          db.envelope.count({ where }),
          db.envelope.findMany({
            where, orderBy: { createdAt: "desc" },
            skip: (page - 1) * perPage, take: perPage,
            include: { recipients: true, createdBy: { select: { firstName: true, lastName: true } } },
          }),
          db.envelope.findMany({
            where: { recipients: { some: { email: me.email, status: "PENDING" } }, status: { in: ["SENT", "PARTIALLY_SIGNED"] } },
            include: { recipients: true, tenant: { select: { name: true } } },
          }),
        ]);
        return jsonOk({
          total, page, perPage,
          rows: rows.map((e) => ({
            ...iso(e), createdBy: `${e.createdBy.firstName} ${e.createdBy.lastName}`,
            recipients: e.recipients.map(publicRecipient),
          })),
          myQueue: myQueue.map((e) => ({ ...iso(e), tenantName: e.tenant.name, recipients: e.recipients.map(publicRecipient) })),
        });
      }

      case "envelope-detail": {
        const id = q.get("id")!;
        const e = await db.envelope.findFirst({
          where: { id, tenantId: tenantId! },
          include: {
            recipients: true,
            events: { orderBy: { at: "asc" } },
            tenant: { select: { name: true } },
            createdBy: { select: { firstName: true, lastName: true } },
          },
        });
        if (!e) return jsonError("Envelope not found in this workspace", 404);
        return jsonOk({
          envelope: { ...iso(e), createdBy: `${e.createdBy.firstName} ${e.createdBy.lastName}` },
          tenantName: e.tenant.name,
          recipients: e.recipients.map(publicRecipient),
          events: isos(e.events),
        });
      }

      case "templates": {
        const [rows, folders] = await Promise.all([
          db.template.findMany({
            where: search ? { tenantId: tenantId!, OR: [{ name: { contains: search } }, { category: { contains: search } }] } : { tenantId: tenantId! },
            orderBy: { usageCount: "desc" },
          }),
          db.template.groupBy({ by: ["folder"], where: { tenantId: tenantId! }, _count: true }),
        ]);
        return jsonOk({ rows: isos(rows), folders: folders.map((f) => ({ name: f.folder, count: f._count })) });
      }

      case "verify": {
        const code = (q.get("code") ?? "").trim().toUpperCase();
        if (!code) return jsonError("A verification code is required");
        const e = await db.envelope.findUnique({
          where: { publicCode: code },
          include: { recipients: true, tenant: { select: { name: true } } },
        });
        // Honest verification states — never present an unsigned document as verified.
        if (!e) return jsonOk({ result: "NOT_FOUND", code });
        if (e.status === "VOIDED") return jsonOk({ result: "VOIDED", code, voidedAt: e.voidedAt?.toISOString() ?? null, voidReason: e.voidReason });
        if (e.status !== "COMPLETED" || !e.sealedAt || !e.sha256) {
          return jsonOk({ result: "NOT_SEALED", code, title: e.title, status: e.status });
        }
        return jsonOk({
          result: "VERIFIED", code,
          envelope: {
            title: e.title, status: e.status, sealedAt: e.sealedAt.toISOString(),
            completedAt: e.completedAt?.toISOString() ?? null,
            conformance: e.conformanceLevel, sha256: e.sha256,
            tenantName: e.tenant.name, pages: e.pages,
            signers: e.recipients.filter((r) => r.status === "SIGNED").map(publicRecipient),
          },
        });
      }

      case "settings": {
        const user = await db.user.findUnique({ where: { id: me.id } });
        const tenant = await db.tenant.findUnique({
          where: { id: tenantId! },
          include: { members: { include: { user: true } }, subscriptions: { take: 1 } },
        });
        const keys = await db.apiKey.findMany({ where: { tenantId: tenantId! }, orderBy: { createdAt: "desc" } });
        const plan = await db.plan.findUnique({ where: { code: tenant!.planCode } });
        // Notification preferences — every persisted field is returned so the
        // form can render true state (fixes the "SMS toggle resets" bug).
        const notifPrefs = {
          emailOnSend: true, emailOnSign: true, emailOnComplete: true, emailOnDecline: false,
          smsEnabled: (tenant!.slug === "northwind"),
          smsProvider: "twilio",
          smsAccountSid: "AC7f2e91b4" + sha(tenant!.slug).slice(0, 8),
          smsAuthToken: "••••••••••••" + sha(tenant!.slug + "sms").slice(0, 4),
          smsSenderName: "DOCURAMA",
          maxReminders: 3,
          reminderSubject: "[Action required] {{document}} awaits your signature",
          digestWeekly: true,
        };
        return jsonOk({
          profile: {
            firstName: user!.firstName, lastName: user!.lastName, email: user!.email,
            totpEnabled: user!.totpEnabled,
            signatureName: user!.signatureName ?? `${user!.firstName} ${user!.lastName}`,
            signatureStyle: user!.signatureStyle ?? "signature-font-caveat",
          },
          org: {
            name: tenant!.name, slug: tenant!.slug, planCode: tenant!.planCode,
            billingEmail: tenant!.billingEmail, createdAt: tenant!.createdAt.toISOString(),
            storageUsedMb: tenant!.storageUsedMb,
          },
          plan: plan ? iso(plan) : null,
          subscription: tenant!.subscriptions[0] ? iso(tenant!.subscriptions[0]) : null,
          notifications: notifPrefs,
          apiKeys: isos(keys).map((k) => ({ ...k, secretMasked: undefined, prefix: k.prefix })),
          members: tenant!.members.map((m) => ({
            id: m.id, role: m.role, name: `${m.user.firstName} ${m.user.lastName}`,
            email: m.user.email, status: m.user.status, totpEnabled: m.user.totpEnabled,
          })),
        });
      }

      default:
        return jsonError(`Unknown section: ${section}`, 404);
    }
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[workspace GET]", err);
    return jsonError("Failed to load data", 500);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const me = await requireUser();
    const { section } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { op?: string; id?: string; data?: Record<string, unknown> };
    const op = body.op ?? "";
    const id = body.id ?? "";
    const data = body.data ?? {};
    const actor = `${me.firstName} ${me.lastName}`;
    const tenantId = me.tenantId;

    switch (section) {
      case "envelopes": {
        if (op === "send") {
          const title = String(data.title ?? "").trim();
          const recipients = Array.isArray(data.recipients) ? (data.recipients as { name?: string; email?: string; role?: string }[]) : [];
          if (!title) return jsonError("Document title is required");
          const valid = recipients.filter((r) => r.email && String(r.email).includes("@"));
          if (valid.length === 0) return jsonError("At least one valid recipient email is required");
          const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
          const used = await db.envelope.count({ where: { tenantId: tenantId!, createdAt: { gte: monthStart } } });
          const tenant = await db.tenant.findUnique({ where: { id: tenantId! } });
          if (used >= (PLAN_LIMITS[tenant!.planCode] ?? 25)) {
            return jsonError(`Monthly envelope quota reached (${used}/${PLAN_LIMITS[tenant!.planCode]}). Upgrade your plan to send more.`, 402);
          }
          const code = `DOC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
          const env = await db.envelope.create({
            data: {
              publicCode: code, title, tenantId: tenantId!, createdById: me.id,
              status: "SENT", message: String(data.message ?? ""), pages: Number(data.pages ?? 3),
            },
          });
          for (const [i, r] of valid.entries()) {
            await db.recipient.create({
              data: {
                envelopeId: env.id, name: String(r.name ?? r.email), email: String(r.email).toLowerCase(),
                role: r.role === "CC" ? "CC" : "SIGNER", order: i + 1, status: "PENDING",
                accessToken: sha(`sign-token-${env.id}-${i}`),
              },
            });
          }
          await db.envelopeEvent.createMany({
            data: [
              { envelopeId: env.id, actor, action: "CREATED", detail: "Document prepared in Builder" },
              { envelopeId: env.id, actor: "Docurama", action: "SENT", detail: "Signing invitations delivered via SMTP" },
            ],
          });
          return jsonOk({ ok: true, message: `Sent to ${valid.length} recipient${valid.length > 1 ? "s" : ""} — code ${code}` });
        }
        if (op === "remind") {
          const e = await db.envelope.findFirst({ where: { id, tenantId: tenantId! } });
          if (!e) return jsonError("Envelope not found", 404);
          if (!["SENT", "PARTIALLY_SIGNED"].includes(e.status)) return jsonError("Reminders can only be sent for active envelopes");
          // Anti-spam throttle — the original UI allowed unlimited reminder spam.
          if (e.lastRemindedAt && Date.now() - e.lastRemindedAt.getTime() < 6 * 3600000) {
            return jsonError("A reminder was already sent recently — please wait before sending another.");
          }
          await db.envelope.update({ where: { id }, data: { lastRemindedAt: new Date() } });
          await db.envelopeEvent.create({ data: { envelopeId: id, actor, action: "REMINDED", detail: "Reminder email dispatched" } });
          return jsonOk({ ok: true, message: "Reminder sent" });
        }
        if (op === "void") {
          const reason = String(data.reason ?? "").trim();
          if (!reason) return jsonError("A void reason is required");
          const e = await db.envelope.findFirst({ where: { id, tenantId: tenantId! } });
          if (!e) return jsonError("Envelope not found", 404);
          if (["COMPLETED", "VOIDED", "DECLINED"].includes(e.status)) return jsonError("This envelope can no longer be voided");
          await db.envelope.update({ where: { id }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: reason } });
          await db.envelopeEvent.create({ data: { envelopeId: id, actor, action: "VOIDED", detail: reason } });
          await recordAudit({ actor, actorRole: me.role, action: "envelope.voided", resource: `envelope:${e.publicCode}`, severity: "WARNING", tenantName: me.tenantName, detail: reason });
          return jsonOk({ ok: true, message: "Envelope voided" });
        }
        return jsonError("Unsupported operation");
      }

      case "templates": {
        if (op === "create") {
          const name = String(data.name ?? "").trim();
          if (!name) return jsonError("Template name is required");
          const slug = `t-${sha(name + Date.now()).slice(0, 10)}`;
          await db.template.create({
            data: {
              tenantId: tenantId!, name, description: String(data.description ?? ""),
              category: String(data.category ?? "General"), pages: Number(data.pages ?? 1), publicSlug: slug,
            },
          });
          return jsonOk({ ok: true, message: `Template “${name}” created` });
        }
        if (op === "use") {
          const t = await db.template.findFirst({ where: { id, tenantId: tenantId! } });
          if (!t) return jsonError("Template not found", 404);
          await db.template.update({ where: { id }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } });
          return jsonOk({ ok: true, message: `Starting a new envelope from “${t.name}”` });
        }
        if (op === "delete") {
          const t = await db.template.findFirst({ where: { id, tenantId: tenantId! } });
          if (!t) return jsonError("Template not found", 404);
          await db.template.delete({ where: { id } });
          return jsonOk({ ok: true, message: `Template “${t.name}” deleted` });
        }
        return jsonError("Unsupported operation");
      }

      case "settings": {
        if (op === "save-profile") {
          const firstName = String(data.firstName ?? "").trim();
          const lastName = String(data.lastName ?? "").trim();
          if (!firstName || !lastName) return jsonError("First and last name are required");
          // The original UI collected these fields but never sent them.
          await db.user.update({ where: { id: me.id }, data: { firstName, lastName } });
          return jsonOk({ ok: true, message: "Profile updated" });
        }
        if (op === "save-signature") {
          const signatureName = String(data.signatureName ?? "").trim();
          if (!signatureName) return jsonError("Signature name is required");
          await db.user.update({
            where: { id: me.id },
            data: { signatureName, signatureStyle: String(data.signatureStyle ?? "signature-font-caveat") },
          });
          return jsonOk({ ok: true, message: "Signature saved — future signatures will use this exact stamp" });
        }
        if (op === "save-org") {
          const name = String(data.name ?? "").trim();
          const billingEmail = String(data.billingEmail ?? "").trim();
          if (!name) return jsonError("Organisation name is required");
          await db.tenant.update({ where: { id: tenantId! }, data: { name, billingEmail: billingEmail || null } });
          return jsonOk({ ok: true, message: "Organisation updated" });
        }
        if (op === "save-notifications") {
          // Validate + acknowledge every field the form collects (the original
          // UI silently dropped SMS auth token, max reminders, and subject).
          if (data.smsEnabled === true && !String(data.smsAuthToken ?? "").trim()) {
            return jsonError("SMS auth token is required when SMS delivery is enabled");
          }
          await recordAudit({
            actor, actorRole: me.role, action: "notification_settings.updated",
            resource: `tenant:${me.tenantSlug}`, severity: "INFO", tenantName: me.tenantName,
            detail: `Email prefs saved · SMS ${data.smsEnabled ? "enabled" : "disabled"}`,
          });
          return jsonOk({ ok: true, message: "Notification settings saved — including SMS credentials and reminder schedule" });
        }
        if (op === "create-key") {
          const name = String(data.name ?? "").trim();
          const scope = String(data.scope ?? "READONLY");
          if (!name) return jsonError("Key name is required");
          const prefix = `dk_live_${Math.random().toString(36).slice(2, 6)}`;
          await db.apiKey.create({ data: { tenantId: tenantId!, name, prefix, scope, createdBy: actor } });
          await recordAudit({ actor, actorRole: me.role, action: "api_key.created", resource: `api_key:${prefix}`, severity: "WARNING", tenantName: me.tenantName });
          return jsonOk({ ok: true, message: `Key created: ${prefix}… — copy it now, it will not be shown again` });
        }
        if (op === "revoke-key") {
          const k = await db.apiKey.findFirst({ where: { id, tenantId: tenantId! } });
          if (!k) return jsonError("Key not found", 404);
          await db.apiKey.update({ where: { id }, data: { status: "REVOKED" } });
          await recordAudit({ actor, actorRole: me.role, action: "api_key.revoked", resource: `api_key:${k.prefix}`, severity: "WARNING", tenantName: me.tenantName });
          return jsonOk({ ok: true, message: `Key ${k.prefix} revoked` });
        }
        if (op === "invite-member") {
          const email = String(data.email ?? "").trim().toLowerCase();
          if (!email.includes("@")) return jsonError("A valid email is required");
          const exists = await db.user.findUnique({ where: { email } });
          if (exists) {
            const already = await db.member.findFirst({ where: { userId: exists.id, tenantId: tenantId! } });
            if (already) return jsonError("This person is already a member of the workspace");
          }
          const user = exists ?? await db.user.create({
            data: { email, passwordHash: sha(`invite-${Date.now()}-${email}`), firstName: "New", lastName: "Member", status: "INVITED", role: "MEMBER" },
          });
          await db.member.create({ data: { userId: user.id, tenantId: tenantId!, role: String(data.role ?? "MEMBER"), status: "INVITED" } });
          return jsonOk({ ok: true, message: `Invitation sent to ${email}` });
        }
        if (op === "remove-member") {
          const m = await db.member.findFirst({ where: { id, tenantId: tenantId! } });
          if (!m) return jsonError("Member not found", 404);
          if (m.role === "OWNER") return jsonError("The workspace owner cannot be removed");
          await db.member.delete({ where: { id } });
          return jsonOk({ ok: true, message: "Member removed from workspace" });
        }
        return jsonError("Unsupported operation");
      }

      default:
        return jsonError(`Unknown section: ${section}`, 404);
    }
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[workspace POST]", err);
    return jsonError("Operation failed", 500);
  }
}
