import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/serializers";
import { resolveStorageKey } from "@/lib/document-store";

/**
 * GET /api/sign/{token}/document — the uploaded PDF for in-page review.
 *
 * The signer portal embeds this so recipients review the real bytes they are
 * about to sign — not a summary card. The 32-byte token is the only
 * authentication, exactly like the signing POST: the recipient of the link is
 * a party to the document.
 *
 * Serving rules (mirror what the portal UI shows, never more):
 *   - envelope must be out for signature (SENT / PARTIALLY_SIGNED);
 *     terminal states and sealed envelopes answer 409 like the page does
 *   - CC recipients never receive the working document (403)
 *   - the stored bytes are re-hashed and compared with the upload digest —
 *     a mismatch is a hard 500, never a silent serve of altered bytes
 *   - no-store: signing links are personal, intermediaries must not cache
 */

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { token } = await ctx.params;

    const recipient = await db.recipient.findUnique({
      where: { accessToken: token },
      include: {
        envelope: {
          select: {
            id: true, status: true, tenantId: true, documentId: true,
          },
        },
      },
    });
    if (!recipient) {
      return jsonError("This signing link is not valid. Check the link in your invitation email.", 404);
    }
    const env = recipient.envelope;
    if (["VOIDED", "DECLINED", "EXPIRED", "COMPLETED", "DRAFT"].includes(env.status)) {
      return jsonError("This document is no longer available for review.", 409);
    }
    if (recipient.role === "CC") {
      return jsonError("You receive a copy of this document. Only signers can review it here.", 403);
    }
    if (!env.documentId) {
      return jsonError("This envelope has no uploaded PDF — review the contract text on the signing page.", 404);
    }

    const doc = await db.document.findFirst({
      where: { id: env.documentId, tenantId: env.tenantId },
      select: { filename: true, storageKey: true, sha256: true },
    });
    if (!doc) {
      return jsonError("This envelope has no uploaded PDF — review the contract text on the signing page.", 404);
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(resolveStorageKey(doc.storageKey));
    } catch {
      console.error(`[sign GET] document file missing on disk: ${doc.storageKey}`);
      return jsonError("The document file could not be read. Contact the sender.", 500);
    }
    // Serve-time integrity: what is on disk must hash to what was recorded at
    // upload — the digest shown on the signing page must never lie.
    const diskDigest = createHash("sha256").update(bytes).digest("hex");
    if (diskDigest !== doc.sha256) {
      console.error(`[sign GET] digest mismatch for ${doc.storageKey}`);
      return jsonError("The document file failed its integrity check. Contact the sender.", 500);
    }

    // RFC 6266: ASCII-safe fallback + UTF-8 filename* for real-world names.
    const asciiName = doc.filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "document.pdf";
    const utf8Name = encodeURIComponent(doc.filename).replace(/'/g, "%27");

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[sign GET]", err);
    return jsonError("Could not load the document. Please try again.", 500);
  }
}
