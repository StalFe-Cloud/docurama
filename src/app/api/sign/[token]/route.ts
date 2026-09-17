import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/serializers";
import { computeEnvelopeDigest } from "@/lib/esign";

/**
 * Public signing endpoint — the engine behind /sign/{token}.
 *
 * The 32-byte base64url accessToken in the link IS the authentication: it is
 * unguessable, unique per recipient, and never shared between signers. No
 * session, no account — a recipient opens the link from their invitation and
 * signs. Every state change lands in the envelope event ledger.
 *
 *   POST /api/sign/{token}  { op: "view" | "sign" | "decline", ... }
 *
 *   view    first open of the link: PENDING → DELIVERED + VIEWED event
 *   sign    { name, font, consent } → recipient SIGNED; when every SIGNER
 *           has signed, the envelope is sealed (COMPLETED, sha256, B-T)
 *   decline { reason } → recipient DECLINED + envelope DECLINED
 */

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const SIGNATURE_FONTS = new Set(["caveat", "dancing-script", "great-vibes"]);

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      op?: string;
      name?: string;
      font?: string;
      reason?: string;
    };
    const op = body.op ?? "";

    const recipient = await db.recipient.findUnique({
      where: { accessToken: token },
      include: { envelope: { include: { recipients: true, events: true, tenant: { select: { name: true } } } } },
    });
    if (!recipient) return jsonError("This signing link is not valid. Check the link in your invitation email.", 404);
    const env = recipient.envelope;

    // Terminal states apply to everyone on the envelope.
    if (["VOIDED", "DECLINED", "EXPIRED"].includes(env.status)) {
      return jsonError(`This document is no longer available for signing (status: ${env.status.toLowerCase()}).`, 409);
    }
    if (recipient.role === "CC") {
      return jsonError("You receive a copy of this document. Only signers can sign it.", 409);
    }

    /* ── view ────────────────────────────────────────────────────────────── */
    if (op === "view") {
      if (recipient.status === "PENDING") {
        await db.$transaction([
          db.recipient.update({ where: { id: recipient.id }, data: { status: "DELIVERED" } }),
          db.envelopeEvent.create({
            data: {
              envelopeId: env.id, actor: recipient.name, action: "VIEWED",
              detail: "Signing link opened by the recipient",
            },
          }),
        ]);
      }
      return jsonOk({ ok: true, status: "DELIVERED" });
    }

    /* ── sign ────────────────────────────────────────────────────────────── */
    if (op === "sign") {
      if (recipient.status === "SIGNED") return jsonError("You have already signed this document.", 409);
      if (env.status !== "SENT" && env.status !== "PARTIALLY_SIGNED") {
        return jsonError("This document can no longer be signed.", 409);
      }
      const name = String(body.name ?? "").trim();
      if (name.length < 2) return jsonError("Please type your full name to sign.");
      const font = SIGNATURE_FONTS.has(String(body.font)) ? String(body.font) : "caveat";
      const signedAt = new Date();

      // Signing order: only the current recipient in line may sign.
      const signers = env.recipients.filter((r) => r.role === "SIGNER").sort((a, b) => a.order - b.order);
      const ahead = signers.find((r) => r.status === "PENDING" || r.status === "DELIVERED");
      if (ahead && ahead.id !== recipient.id) {
        return jsonError(`${ahead.name} signs before you. You will be able to sign once they have completed.`, 409);
      }

      const updated = await db.$transaction(async (tx) => {
        await tx.recipient.update({
          where: { id: recipient.id },
          data: { status: "SIGNED", signedAt },
        });
        await tx.envelopeEvent.create({
          data: {
            envelopeId: env.id, actor: recipient.name, action: "SIGNED",
            detail: `Signed by ${name} <${recipient.email}> via signing link (${font} signature)`,
          },
        });

        const all = await tx.recipient.findMany({ where: { envelopeId: env.id, role: "SIGNER" } });
        const remaining = all.filter((r) => r.status !== "SIGNED");
        if (remaining.length > 0) {
          const env2 = await tx.envelope.update({
            where: { id: env.id }, data: { status: "PARTIALLY_SIGNED" },
          });
          return { envelope: env2, sealed: false };
        }

        // Every signer has signed — seal the envelope.
        const events = await tx.envelopeEvent.findMany({ where: { envelopeId: env.id } });
        const digest = computeEnvelopeDigest({
          id: env.id, publicCode: env.publicCode, title: env.title, pages: env.pages,
          createdAt: env.createdAt, documentSha256: env.sha256,
          recipients: all, events,
        });
        const sealedEnv = await tx.envelope.update({
          where: { id: env.id },
          data: {
            status: "COMPLETED", completedAt: signedAt, sealedAt: signedAt,
            sha256: digest, conformanceLevel: env.conformanceLevel ?? "B-T",
          },
        });
        await tx.envelopeEvent.create({
          data: {
            envelopeId: env.id, actor: "Docurama", action: "SEALED",
            detail: `All signers completed. Envelope sealed (SHA-256 ${digest.slice(0, 12)}…), verification code ${env.publicCode}`,
          },
        });
        return { envelope: sealedEnv, sealed: true };
      });

      return jsonOk({
        ok: true,
        status: "SIGNED",
        envelopeStatus: updated.envelope.status,
        sealed: updated.sealed,
        code: env.publicCode,
        signedAt: signedAt.toISOString(),
      });
    }

    /* ── decline ─────────────────────────────────────────────────────────── */
    if (op === "decline") {
      if (recipient.status === "SIGNED") return jsonError("You have already signed this document - it can no longer be declined.", 409);
      if (env.status !== "SENT" && env.status !== "PARTIALLY_SIGNED") {
        return jsonError("This document can no longer be declined.", 409);
      }
      const reason = String(body.reason ?? "").trim().slice(0, 500) || "No reason provided";
      await db.$transaction([
        db.recipient.update({ where: { id: recipient.id }, data: { status: "DECLINED" } }),
        db.envelope.update({ where: { id: env.id }, data: { status: "DECLINED" } }),
        db.envelopeEvent.create({
          data: {
            envelopeId: env.id, actor: recipient.name, action: "DECLINED",
            detail: `Declined by ${recipient.name} <${recipient.email}>: ${reason}`,
          },
        }),
      ]);
      return jsonOk({ ok: true, status: "DECLINED", envelopeStatus: "DECLINED" });
    }

    return jsonError("Unknown operation", 400);
  } catch (err) {
    console.error("[sign POST]", err);
    return jsonError("Signing failed. Please try again.", 500);
  }
}
