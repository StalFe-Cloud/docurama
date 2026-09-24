import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/serializers";
import { sealedPdfBytes } from "@/lib/signed-pdf";

/**
 * GET /api/sign/{token}/signed-pdf: every signer and CC of a completed
 * envelope downloads the sealed, PAdES-signed PDF with their own link.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!token || token.length > 256) return jsonError("This link is not valid.", 404);
    const recipient = await db.recipient.findUnique({
      where: { accessToken: token },
      select: { name: true, envelope: { select: { id: true, status: true, documentId: true, contractText: true, tenant: { select: { status: true } } } } },
    });
    if (!recipient) return jsonError("This link is not valid.", 404);
    const e = recipient.envelope;
    if (e.tenant.status === "SUSPENDED") return jsonError("This document is not available.", 409);
    if (e.status !== "COMPLETED") return jsonError("The signed PDF is available once every signer has signed.", 409);
    if (!e.documentId && !e.contractText) return jsonError("There is no signed PDF for this document.", 404);
    const pdf = await sealedPdfBytes(e.id);
    if (!pdf) return jsonError("The signed PDF is not available yet. Please try again in a moment.", 503);
    await db.envelopeEvent.create({
      data: { envelopeId: e.id, actor: recipient.name, action: "SIGNED_PDF_DOWNLOADED", detail: "Signed PDF downloaded with the signing link" },
    }).catch(() => undefined);
    return new Response(new Uint8Array(pdf.bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(pdf.filename)}`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[sign signed-pdf]", error);
    return jsonError("Download failed", 500);
  }
}
