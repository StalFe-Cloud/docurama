import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/serializers";
import { sealedPdfBytes } from "@/lib/signed-pdf";

/** GET /api/workspace/envelopes/{idOrCode}/signed-pdf: the sealed, PAdES-signed PDF. */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    if (!me.tenantId) return jsonError("No workspace membership for this account", 403);
    const { id } = await ctx.params;
    const e = await db.envelope.findFirst({
      where: { tenantId: me.tenantId, OR: [{ id }, { publicCode: id.toUpperCase() }] },
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
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[workspace signed-pdf]", error);
    return jsonError("Download failed", 500);
  }
}
