import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { publicRecipient, iso, isos, envelopeRow, jsonError, jsonOk } from "@/lib/serializers";
import { buildEvidencePack, recordEvidencePackExport, EvidencePackError } from "@/lib/evidence-pack";
import { apiAccessAllowed } from "@/lib/billing";
import { verifyEnvelopeCode } from "@/lib/verify";
import { sealedPdfBytes } from "@/lib/signed-pdf";

/**
 * Public integration API (v1) - the surface documented in Settings → API.
 *
 * Authentication: `X-API-Key: <full key>` (created in Settings → API; the full
 * secret is displayed exactly once and only its SHA-256 hash is stored).
 * Scopes: READONLY < ENVELOPES / TEMPLATES < FULL.
 *
 *   GET /api/v1/envelopes?status=&page=&perPage=
 *   GET /api/v1/envelopes/{idOrCode}
 *   GET /api/v1/envelopes/{idOrCode}/evidence-pack   (ZIP, sealed envelopes)
 *   GET /api/v1/envelopes/{idOrCode}/signed-pdf      (PAdES-signed PDF, sealed uploads)
 *   GET /api/v1/templates
 *   GET /api/v1/verify/{code}          (public - no key required; falls back
 *                                       to pushed attestations for codes that
 *                                       belong to self-hosted instances)
 */

export const dynamic = "force-dynamic";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type Ctx = { params: Promise<{ path: string[] }> };

async function resolveApiKey(req: NextRequest) {
  const key = req.headers.get("x-api-key")?.trim();
  if (!key) return { error: jsonError("Missing X-API-Key header - create a key in Settings → API", 401) };
  const row = await db.apiKey.findFirst({
    where: { secretHash: sha(key), status: "ACTIVE", tenantId: { not: null } },
    include: { tenant: true },
  });
  if (!row || !row.tenant) return { error: jsonError("Invalid or revoked API key", 401) };
  if (!(await apiAccessAllowed(row.tenant.id))) return { error: jsonError("API access is unavailable for this workspace plan or status", 403) };
  await db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { row };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { path } = await ctx.params;
    const [resource, ...rest] = path;

    // Public verification - same engine as verify.docurama.eu.
    if (resource === "verify" && rest.length === 1) {
      return jsonOk(await verifyEnvelopeCode(rest[0]));
    }

    const auth = await resolveApiKey(req);
    if (auth.error) return auth.error;
    const { row } = auth;
    const tenantId = row.tenantId!;
    const url = new URL(req.url);

    if (resource === "envelopes" && rest.length === 0) {
      const status = url.searchParams.get("status");
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const perPage = Math.min(100, Math.max(5, Number(url.searchParams.get("perPage") ?? 20)));
      const where: Record<string, unknown> = { tenantId };
      if (status && status !== "ALL") where.status = status;
      const [total, rows] = await Promise.all([
        db.envelope.count({ where }),
        db.envelope.findMany({
          where, orderBy: { createdAt: "desc" },
          skip: (page - 1) * perPage, take: perPage,
          include: { recipients: true, createdBy: { select: { firstName: true, lastName: true } } },
        }),
      ]);
      return jsonOk({
        total, page, perPage,
        rows: rows.map((e) => ({
          ...envelopeRow(e),
          createdBy: `${e.createdBy.firstName} ${e.createdBy.lastName}`,
          recipients: e.recipients.map(publicRecipient),
        })),
      });
    }

    if (resource === "envelopes" && rest.length === 1) {
      const key = rest[0];
      const e = await db.envelope.findFirst({
        where: { tenantId, OR: [{ id: key }, { publicCode: key.toUpperCase() }] },
        include: { recipients: true, events: { orderBy: { at: "asc" } }, tenant: { select: { name: true } } },
      });
      if (!e) return jsonError("Envelope not found", 404);
      return jsonOk({
        envelope: {
          id: e.id, publicCode: e.publicCode, title: e.title, status: e.status,
          message: e.message, pages: e.pages, conformanceLevel: e.conformanceLevel,
          sha256: e.sha256, documentId: e.documentId,
          sealedAt: e.sealedAt?.toISOString() ?? null,
          completedAt: e.completedAt?.toISOString() ?? null,
          voidedAt: e.voidedAt?.toISOString() ?? null,
          voidReason: e.voidReason,
          createdAt: e.createdAt.toISOString(),
          lastRemindedAt: e.lastRemindedAt?.toISOString() ?? null,
          autoRemind: e.autoRemind, reminderCount: e.reminderCount,
          attestedAt: e.attestedAt?.toISOString() ?? null,
          verifiedSenderDomain: e.verifiedSenderDomain,
        },
        tenantName: e.tenant.name,
        recipients: e.recipients.map(publicRecipient),
        events: isos(e.events),
      });
    }

    // Signed evidence pack (ZIP) — sealed envelopes of this tenant only.
    if (resource === "envelopes" && rest.length === 2 && rest[1] === "evidence-pack") {
      const key = rest[0];
      const pack = await buildEvidencePack(key, tenantId);
      await recordEvidencePackExport(key, tenantId, "API key");
      return new Response(new Uint8Array(pack.bytes), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${pack.filename}"`,
          "cache-control": "no-store",
        },
      });
    }

    // The sealed, PAdES-signed PDF — sealed envelopes of this tenant with an uploaded document.
    if (resource === "envelopes" && rest.length === 2 && rest[1] === "signed-pdf") {
      const e = await db.envelope.findFirst({
        where: { tenantId, OR: [{ id: rest[0] }, { publicCode: rest[0].toUpperCase() }] },
        select: { id: true, status: true, documentId: true, contractText: true },
      });
      if (!e) return jsonError("Envelope not found", 404);
      if (e.status !== "COMPLETED") return jsonError("The signed PDF exists once every signer has signed", 409);
      if (!e.documentId && !e.contractText) return jsonError("This envelope has no document to seal as a PDF (sent before contract text was kept): export its evidence pack instead", 404);
      const pdf = await sealedPdfBytes(e.id);
      if (!pdf) return jsonError("The signed PDF could not be produced; see the envelope's audit trail", 503);
      return new Response(new Uint8Array(pdf.bytes), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(pdf.filename)}`,
          "cache-control": "no-store",
          ...(pdf.level ? { "x-docurama-pades-level": pdf.level } : {}),
        },
      });
    }

    if (resource === "templates" && rest.length === 0) {
      if (row.scope !== "TEMPLATES" && row.scope !== "FULL") {
        return jsonError("This key does not have the TEMPLATES scope", 403);
      }
      const rows = await db.template.findMany({
        where: { tenantId }, orderBy: { usageCount: "desc" }, take: 100,
      });
      return jsonOk({ rows: isos(rows) });
    }

    return jsonError(`Unknown v1 resource: /${path.join("/")}`, 404);
  } catch (err) {
    if (err instanceof Response) return err;
    if (err instanceof EvidencePackError) return jsonError(err.message, err.status);
    console.error("[api v1]", err);
    return jsonError("Request failed", 500);
  }
}
