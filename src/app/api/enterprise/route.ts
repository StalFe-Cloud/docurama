import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/serializers";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Public Enterprise lead intake - POST /api/enterprise
 *
 * Creates an EnterpriseLead (status NEW) for the admin pipeline. The endpoint
 * is unauthenticated by design; abuse controls are a honeypot field, strict
 * field validation, length caps and a per-email rate limit (max 3 open leads
 * per email within 24h). A security event records each submission for review.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid request body");
  }

  // Honeypot: real users never see (or fill) this field.
  if (String(body.honey ?? "").trim() !== "") {
    return jsonOk({ ok: true, message: "Thank you" });
  }

  const contactName = String(body.contactName ?? "").trim();
  const workEmail = String(body.workEmail ?? "").trim().toLowerCase();
  const companyName = String(body.companyName ?? "").trim();
  const companySize = String(body.companySize ?? "").trim().slice(0, 20) || null;
  const country = String(body.country ?? "").trim().slice(0, 60) || null;
  const monthlyVolume = String(body.monthlyVolume ?? "").trim().slice(0, 30) || null;
  const needs = String(body.needs ?? "").trim().slice(0, 1000) || null;
  const preferredDate = String(body.preferredDate ?? "").trim().slice(0, 30) || null;

  if (contactName.length < 2 || contactName.length > 80) return jsonError("Your name is required (2-80 characters)");
  if (!EMAIL_RE.test(workEmail) || workEmail.length > 120) return jsonError("A valid work email is required");
  if (companyName.length < 2 || companyName.length > 120) return jsonError("Company name is required (2-120 characters)");

  // Rate limit: at most 3 open (not WON/LOST) leads per email per 24 hours.
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const openLeads = await db.enterpriseLead.count({
    where: { workEmail, createdAt: { gte: since }, status: { notIn: ["WON", "LOST"] } },
  });
  if (openLeads >= 3) {
    return jsonError("A request from this email is already in our pipeline - we reply within one business day", 429);
  }

  const lead = await db.enterpriseLead.create({
    data: {
      contactName, workEmail, companyName, companySize, country,
      monthlyVolume, needs, preferredDate, status: "NEW",
    },
  });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "127.0.0.1";
  await recordAudit({
    actor: contactName,
    actorRole: "VISITOR",
    action: "enterprise.lead.created",
    resource: `lead:${lead.id}`,
    tenantName: companyName,
    ip,
    detail: `Public enterprise lead from ${workEmail} (volume: ${monthlyVolume ?? "unspecified"})`,
  });
  await db.securityEvent.create({
    data: {
      type: "ENTERPRISE_LEAD",
      severity: "INFO",
      actor: workEmail,
      ip,
      blocked: false,
      detail: `Lead ${lead.id} for ${companyName}${companySize ? ` (${companySize})` : ""}`,
    },
  });

  return jsonOk({ ok: true, message: "Request received - we reply within one business day" });
}
