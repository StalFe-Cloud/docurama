import { NextRequest, NextResponse } from "next/server";
import { getPortalProof } from "@/lib/transparency";

/**
 * GET /api/transparency/proof/{code} — public inclusion proof that a
 * verification code's attestation is committed in the portal's append-only
 * log. Returns the log entry, the chain segment up to the current head, and
 * the signed checkpoint. A third party (or the evidence pack's offline
 * verifier) re-hashes the chain and checks the checkpoint signature — no
 * trust in this server's storage required, only in the key they pinned.
 */

export const dynamic = "force-dynamic";

const CODE_RE = /^DOC-[A-Z0-9]{4,16}$/;

type Ctx = { params: Promise<{ code: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { code } = await ctx.params;
    const normalized = decodeURIComponent(code).toUpperCase().trim();
    if (!CODE_RE.test(normalized)) {
      return NextResponse.json({ error: "Invalid verification code format" }, { status: 400 });
    }
    const proof = await getPortalProof(normalized);
    if (!proof) {
      return NextResponse.json(
        { error: "No attestation witnessed for this code", code: normalized },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        code: normalized,
        entry: proof.entry,
        segment: proof.segment,
        truncated: proof.truncated,
        checkpoint: proof.checkpoint,
        howToVerify:
          "Recompute each segment entry's head from {seq, code, instanceThumbprint, sha256, instanceEntryHash, prevHead, at} (SHA-256 over canonical JSON, keys sorted, no whitespace), check each prevHead links to the previous head, then verify the checkpoint signature with the embedded publicKeyPem. See docs/TRANSPARENCY-LOG.md.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[transparency proof GET]", err);
    return NextResponse.json({ error: "Proof unavailable" }, { status: 500 });
  }
}
