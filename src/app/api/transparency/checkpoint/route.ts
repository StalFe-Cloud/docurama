import { NextResponse } from "next/server";
import { buildPortalCheckpoint, getPortalLogHead } from "@/lib/transparency";

/**
 * GET /api/transparency/checkpoint — the public, pollable checkpoint of the
 * verification portal's append-only attestation log.
 *
 * Anyone can run a monitor against this endpoint: pin the portal key on first
 * sight (keyFingerprint), then keep every checkpoint. A log that shrinks, or
 * whose head changes without new entries chaining from the old one, is proof
 * of a rewrite. Same gossip model as Certificate Transparency, scaled down.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const checkpoint = await buildPortalCheckpoint();
    const head = await getPortalLogHead();
    return NextResponse.json(
      {
        ok: true,
        endpoint: "docurama-transparency-checkpoint",
        log: { size: head.seq, head: head.head },
        checkpoint,
        howToMonitor:
          "Poll this endpoint, pin keyFingerprint (TOFU), and keep every checkpoint — a shrinking log or a re-anchored head is proof of a rewrite. Inclusion proofs: /api/transparency/proof/{code}",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[transparency checkpoint GET]", err);
    return NextResponse.json({ error: "Checkpoint unavailable" }, { status: 500 });
  }
}
