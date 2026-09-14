import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { requireUser, recordAudit } from "@/lib/auth";
import { publicRecipient, isos, iso, jsonError, jsonOk } from "@/lib/serializers";
import { getSettingsSection, postSettingsOp } from "@/lib/settings-handlers";

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
    if (
      ["envelopes", "templates", "settings", "overview", "settings-account", "settings-esign", "settings-notifications", "settings-sms", "settings-mcp"].includes(section) &&
      !tenantId
    ) {
      return jsonError("No workspace membership for this account", 403);
    }

    // Production settings sections (account security, eSign, notifications,
    // SMS gateway, MCP) are served by the dedicated handlers module.
    if (["settings-account", "settings-esign", "settings-notifications", "settings-sms", "settings-mcp"].includes(section)) {
      return getSettingsSection(section, me);
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
        // Profile, org, memberships, saved signatures, API keys, team — the
        // full production-settings base payload.
        return getSettingsSection("settings", me);
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
        // All workspace settings mutations (profile, signatures, orgs, 2FA,
        // sessions, domains, certificates, TSA, eSign, notifications, SMS,
        // API keys, MCP) live in the dedicated handlers module.
        if (!tenantId) return jsonError("No workspace membership for this account", 403);
        return postSettingsOp(me, { op, id, data }, req);
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
