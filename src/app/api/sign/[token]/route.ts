import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { jsonError, jsonOk } from "@/lib/serializers";
import { SEAL_FORMAT, buildSealManifest, sealDigest, sealManifestJson } from "@/lib/seal";
import { pushAttestationForEnvelope } from "@/lib/attestation";
import { appendSealCommitment } from "@/lib/transparency";
import { timestampEnvelopeSeal } from "@/lib/tsa";
import { sealEnvelopePdf } from "@/lib/signed-pdf";
import { getSessionUser } from "@/lib/auth";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { queueEnvelopeEvent, retryFailedDeliveries } from "@/lib/webhooks";
import { processOutbox } from "@/lib/mail";
import { queueCompletion, queueSenderAlert } from "@/lib/notify";
import { serializableTransaction } from "@/lib/transaction";

/** Signing tokens authenticate recipients; every state decision is re-read in
 * the same serializable transaction as its ledger entry and durable outbox.
 * A retry may replay database work, never a network request. */
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ token: string }> };
const SIGNATURE_FONTS = new Set(["caveat", "dancing-script", "great-vibes"]);

type PlacedField = { id: string; type: string; recipientEmail?: string; label?: string; value?: string; [key: string]: unknown };

function parseFields(raw: string | null): PlacedField[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((f): f is PlacedField => !!f && typeof f === "object" && typeof (f as PlacedField).id === "string") : [];
  } catch {
    return [];
  }
}

/** A drawn or uploaded signature: PNG or JPEG, at most 200 KB, magic bytes checked. */
const MAX_SIGNATURE_IMAGE_BYTES = 200 * 1024;
function signatureImage(value: unknown): { dataUrl: string; bytes: Buffer } | null {
  const m = typeof value === "string" ? /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(value) : null;
  if (!m) return null;
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_SIGNATURE_IMAGE_BYTES) return null;
  const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((m[1] === "png" && !png) || (m[1] === "jpeg" && !jpeg)) return null;
  return { dataUrl: value as string, bytes };
}

type Adopted = { method: "type" | "draw" | "upload" | "saved"; font: string | null; image: string | null; sha256: string };

/**
 * The signature the signer adopted. "saved" is resolved server-side from the
 * signed-in account whose email is this recipient's, never from the client.
 */
async function adoptedSignature(body: Record<string, unknown>, recipientEmail: string, name: string, font: string): Promise<Adopted | Response> {
  const raw = body.signature && typeof body.signature === "object" ? body.signature as Record<string, unknown> : {};
  const method = ["draw", "upload", "saved"].includes(String(raw.method)) ? String(raw.method) as Adopted["method"] : "type";
  if (method === "saved") {
    const me = await getSessionUser().catch(() => null);
    if (!me || me.email.toLowerCase() !== recipientEmail.toLowerCase()) {
      return jsonError("Sign in with the account this document was sent to, to use your saved signature.", 403);
    }
    const saved = await db.userSignature.findFirst({ where: { userId: me.id, kind: "signature" }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });
    if (!saved) return jsonError("Your account has no saved signature yet.", 409);
    const image = saved.method === "type" ? null : signatureImage(saved.value);
    if (image) return { method, font: null, image: image.dataUrl, sha256: createHash("sha256").update(image.bytes).digest("hex") };
    const savedFont = SIGNATURE_FONTS.has(String(saved.font)) ? String(saved.font) : font;
    return { method, font: savedFont, image: null, sha256: createHash("sha256").update(`type:${savedFont}:${name}`).digest("hex") };
  }
  if (method === "draw" || method === "upload") {
    const image = signatureImage(raw.image);
    if (!image) return jsonError(method === "draw" ? "Draw your signature before signing." : "Upload a PNG or JPEG signature image under 200 KB.");
    return { method, font: null, image: image.dataUrl, sha256: createHash("sha256").update(image.bytes).digest("hex") };
  }
  return { method: "type", font, image: null, sha256: createHash("sha256").update(`type:${font}:${name}`).digest("hex") };
}

const METHOD_TEXT: Record<Adopted["method"], string> = {
  type: "typed signature", draw: "drawn signature", upload: "uploaded signature image", saved: "saved signature",
};

const textLabel = (f: PlacedField) => (f.label && f.label !== "Text Field" ? f.label : "Text");
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((part) => part[0]!.toUpperCase()).join("").slice(0, 4);

async function loadRecipient(tx: Prisma.TransactionClient, token: string) {
  const recipient = await tx.recipient.findUnique({
    where: { accessToken: token },
    include: { envelope: { include: {
      recipients: true,
      document: { select: { sha256: true } },
      createdBy: { select: { email: true, firstName: true, lastName: true } },
      tenant: { select: { status: true } },
    } } },
  });
  if (!recipient) throw jsonError("This signing link is not valid. Check the link in your invitation email.", 404);
  if (recipient.envelope.tenant.status === "SUSPENDED") throw jsonError("This document is not available for signing.", 409);
  if (["VOIDED", "DECLINED", "EXPIRED"].includes(recipient.envelope.status)) {
    throw jsonError(`This document is no longer available for signing (status: ${recipient.envelope.status.toLowerCase()}).`, 409);
  }
  if (recipient.role !== "SIGNER") throw jsonError("You receive a copy of this document. Only signers can sign it.", 409);
  return recipient;
}

function wakeWebhooks() {
  // The durable rows, not this best-effort wake-up, guarantee eventual work.
  void retryFailedDeliveries(20).catch((error) => console.warn("[sign] webhook wake-up failed", error));
  void processOutbox(20).catch((error) => console.warn("[sign] mail wake-up failed", error));
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    if (!token || token.length > 256) return jsonError("This signing link is not valid. Check the link in your invitation email.", 404);
    const input: unknown = await req.json().catch(() => null);
    if (!input || typeof input !== "object" || Array.isArray(input)) return jsonError("Invalid signing request", 400);
    const body = input as Record<string, unknown>;
    const op = body.op;
    if (!["view", "sign", "decline"].includes(String(op))) return jsonError("Unknown operation", 400);
    const actionAt = new Date();
    const origin = req.nextUrl.origin;

    if (op === "view") {
      const status = await serializableTransaction(async (tx) => {
        const recipient = await loadRecipient(tx, token);
        const envelope = recipient.envelope;
        if (recipient.status !== "PENDING") return recipient.status;
        if (!["SENT", "PARTIALLY_SIGNED"].includes(envelope.status)) {
          throw jsonError("This document can no longer be viewed for signing.", 409);
        }
        await tx.recipient.update({ where: { id: recipient.id }, data: { status: "DELIVERED" } });
        await tx.envelopeEvent.create({ data: {
          envelopeId: envelope.id, actor: recipient.name, action: "VIEWED", at: actionAt,
          detail: "Signing link opened by the recipient",
        } });
        await queueEnvelopeEvent(tx, envelope.tenantId, "envelope.viewed", {
          code: envelope.publicCode, title: envelope.title, status: envelope.status,
          recipient: { name: recipient.name, email: recipient.email },
        });
        await queueSenderAlert(tx, envelope, "viewed", { origin, createdAt: actionAt, signerName: recipient.name });
        return "DELIVERED";
      });
      wakeWebhooks();
      return jsonOk({ ok: true, status });
    }

    if (op === "decline") {
      const reason = String(body.reason ?? "").trim().slice(0, 500) || "No reason provided";
      await serializableTransaction(async (tx) => {
        const recipient = await loadRecipient(tx, token);
        const envelope = recipient.envelope;
        if (recipient.status === "SIGNED") throw jsonError("You have already signed this document - it can no longer be declined.", 409);
        if (!["SENT", "PARTIALLY_SIGNED"].includes(envelope.status)) throw jsonError("This document can no longer be declined.", 409);
        await tx.recipient.update({ where: { id: recipient.id }, data: { status: "DECLINED" } });
        await tx.envelope.update({ where: { id: envelope.id }, data: { status: "DECLINED" } });
        await tx.envelopeEvent.create({ data: {
          envelopeId: envelope.id, actor: recipient.name, action: "DECLINED", at: actionAt,
          detail: `Declined by ${recipient.name} <${recipient.email}>: ${reason}`,
        } });
        await queueEnvelopeEvent(tx, envelope.tenantId, "envelope.declined", {
          code: envelope.publicCode, title: envelope.title, status: "DECLINED",
          recipient: { name: recipient.name, email: recipient.email }, reason,
        });
        await queueSenderAlert(tx, envelope, "declined", { origin, createdAt: actionAt, signerName: recipient.name, reason });
      });
      wakeWebhooks();
      return jsonOk({ ok: true, status: "DECLINED", envelopeStatus: "DECLINED" });
    }

    const name = String(body.name ?? "").trim();
    if (name.length < 2 || name.length > 200) return jsonError("Please type your full name to sign (2 to 200 characters).");
    const font = SIGNATURE_FONTS.has(String(body.font)) ? String(body.font) : "caveat";
    // Resolved before the transaction: it may read the session and saved signatures.
    const tokenOwner = await db.recipient.findUnique({ where: { accessToken: token }, select: { email: true } });
    if (!tokenOwner) return jsonError("This signing link is not valid. Check the link in your invitation email.", 404);
    const adopted = await adoptedSignature(body, tokenOwner.email, name, font);
    if (adopted instanceof Response) return adopted;
    const updated = await serializableTransaction(async (tx) => {
      const recipient = await loadRecipient(tx, token);
      const envelope = recipient.envelope;
      if (recipient.status === "SIGNED") throw jsonError("You have already signed this document.", 409);
      if (!["SENT", "PARTIALLY_SIGNED"].includes(envelope.status)) throw jsonError("This document can no longer be signed.", 409);
      const signers = envelope.recipients.filter((item) => item.role === "SIGNER").sort((a, b) => a.order - b.order);
      const ahead = signers.find((item) => item.status === "PENDING" || item.status === "DELIVERED");
      if (ahead && ahead.id !== recipient.id) {
        throw jsonError(`${ahead.name} signs before you. You will be able to sign once they have completed.`, 409);
      }
      // Holders the sender placed for this signer: text values are required and
      // recorded in the SIGNED audit event and on the envelope's fields; date,
      // signature and initials holders are stamped from the signing act itself.
      // All of them are bound by the seal (src/lib/seal.ts) once the last
      // signer completes.
      const placed = parseFields(envelope.fields);
      const mine = placed.filter((f) => String(f.recipientEmail ?? "").toLowerCase() === recipient.email.toLowerCase());
      const submitted = body.fieldValues && typeof body.fieldValues === "object" && !Array.isArray(body.fieldValues)
        ? body.fieldValues as Record<string, unknown> : {};
      const filled: string[] = [];
      for (const f of mine) {
        if (f.type === "text") {
          const value = String(submitted[f.id] ?? "").trim().slice(0, 200);
          if (!value) throw jsonError(`Please fill in "${textLabel(f)}" before signing.`);
          f.value = value;
          filled.push(`${textLabel(f)}="${value.replace(/"/g, "'")}"`);
        } else if (f.type === "date") {
          f.value = actionAt.toISOString().slice(0, 10);
        } else if (f.type === "signature") {
          f.value = name;
        } else if (f.type === "initials") {
          f.value = initialsOf(name);
        }
      }
      const fieldsJson = mine.length > 0 ? JSON.stringify(placed) : envelope.fields;
      if (mine.length > 0) {
        await tx.envelope.update({ where: { id: envelope.id }, data: { fields: fieldsJson } });
      }
      await tx.recipient.update({ where: { id: recipient.id }, data: {
        status: "SIGNED", signedAt: actionAt,
        signatureMethod: adopted.method, signatureFont: adopted.font, signatureImage: adopted.image, signatureSha256: adopted.sha256,
      } });
      await tx.envelopeEvent.create({ data: {
        envelopeId: envelope.id, actor: recipient.name, action: "SIGNED", at: actionAt,
        detail: `Signed by ${name} <${recipient.email}> via signing link (${adopted.method === "type" ? `${font} ` : ""}${METHOD_TEXT[adopted.method]}, SHA-256 ${adopted.sha256.slice(0, 12)}...)` +
          (mine.length ? `; completed ${mine.length} placed field(s)${filled.length ? `: ${filled.join(", ")}` : ""}` : ""),
      } });
      const all = await tx.recipient.findMany({ where: { envelopeId: envelope.id, role: "SIGNER" } });
      const sealed = all.length > 0 && all.every((item) => item.status === "SIGNED");
      const signerCount = all.filter((item) => item.status === "SIGNED").length;
      let saved;
      if (sealed) {
        const senderDomain = envelope.createdBy.email.split("@")[1]?.toLowerCase();
        const verifiedDomain = senderDomain ? await tx.domain.findFirst({
          where: { tenantId: envelope.tenantId, domain: senderDomain, purpose: "SENDING", status: "VERIFIED" },
          select: { domain: true },
        }) : null;
        // Seal v2: the digest covers the document fingerprint, every recipient
        // (CCs included), every event so far and every field value, read in
        // this transaction so nothing can land between reading and sealing.
        const [recipients, events] = await Promise.all([
          tx.recipient.findMany({ where: { envelopeId: envelope.id } }),
          tx.envelopeEvent.findMany({ where: { envelopeId: envelope.id } }),
        ]);
        const manifest = buildSealManifest({
          publicCode: envelope.publicCode, title: envelope.title, pages: envelope.pages,
          createdAt: envelope.createdAt, sealedAt: actionAt,
          documentSha256: envelope.document?.sha256 ?? null, contractText: envelope.contractText,
          verifiedSenderDomain: verifiedDomain?.domain ?? null,
          recipients, events, fields: fieldsJson,
        });
        const digest = sealDigest(manifest);
        saved = await tx.envelope.update({ where: { id: envelope.id }, data: {
          status: "COMPLETED", completedAt: actionAt, sealedAt: actionAt, sha256: digest,
          sealFormat: SEAL_FORMAT, sealManifest: sealManifestJson(manifest),
          // B-B until the RFC 3161 timestamp below lands and raises it to B-T.
          conformanceLevel: envelope.conformanceLevel ?? "B-B", verifiedSenderDomain: verifiedDomain?.domain ?? null,
        } });
        await tx.envelopeEvent.create({ data: {
          envelopeId: envelope.id, actor: "Docurama", action: "SEALED", at: actionAt,
          detail: `All signers completed. Envelope sealed (${SEAL_FORMAT}, SHA-256 ${digest.slice(0, 12)}... binding ` +
            `${manifest.document.sha256 ? "the document, " : ""}${recipients.length} recipient(s), ${manifest.events.length} event(s) ` +
            `and ${manifest.fields.length} field value(s)), verification code ${envelope.publicCode}`,
        } });
      } else {
        saved = await tx.envelope.update({ where: { id: envelope.id }, data: { status: "PARTIALLY_SIGNED" } });
      }
      await queueEnvelopeEvent(tx, envelope.tenantId, "envelope.signed", {
        code: envelope.publicCode, title: envelope.title, status: saved.status,
        recipient: { name: recipient.name, email: recipient.email }, sealed,
      });
      if (sealed) await queueEnvelopeEvent(tx, envelope.tenantId, "envelope.completed", {
        code: envelope.publicCode, title: envelope.title, status: "COMPLETED", sha256: saved.sha256,
        sealedAt: actionAt.toISOString(), conformance: saved.conformanceLevel, signerCount,
      });
      // The sender hears about progress; at completion everyone gets their signed copy.
      if (sealed) {
        await queueCompletion(tx, envelope, envelope.recipients, {
          origin, createdAt: actionAt, hasPdf: !!envelope.document || !!envelope.contractText,
        });
      } else {
        await queueSenderAlert(tx, envelope, "signed", { origin, createdAt: actionAt, signerName: name });
      }
      return { envelope: saved, sealed, signerCount };
    });
    wakeWebhooks();

    if (updated.sealed) {
      // Timestamp, transparency and attestation are network or append-only
      // work: none of it may run inside a retried transaction callback. The
      // timestamp goes first so the commitment records the final seal level.
      await timestampEnvelopeSeal(updated.envelope.id);
      const envelope = (await db.envelope.findUnique({ where: { id: updated.envelope.id } })) ?? updated.envelope;
      try {
        await appendSealCommitment({ tenantId: envelope.tenantId, envelopeId: envelope.id, commitment: {
          code: envelope.publicCode, sha256: envelope.sha256 ?? "", sealedAt: (envelope.sealedAt ?? actionAt).toISOString(),
          conformance: envelope.conformanceLevel, pages: envelope.pages, signerCount: updated.signerCount,
        } });
      } catch (error) {
        console.warn("[sign] transparency append failed:", error);
      }
      // The sealed, PAdES-signed PDF (uploaded documents). A failure is logged on
      // the envelope and retried on first download; it never fails the signature.
      await sealEnvelopePdf(envelope.id).catch((error) => console.warn("[sign] sealed PDF failed:", error));
      const attest = await pushAttestationForEnvelope(envelope.id).catch(() => ({ pushed: false, note: "attestation push crashed" }));
      if (!attest.pushed && process.env.EVIDENCE_PORTAL_URL) console.warn(`[sign] attestation not pushed for ${envelope.publicCode}: ${attest.note}`);
    }
    if (body.saveSignature === true && adopted.method !== "saved") {
      // Adopt once, reuse everywhere: store it on the signed-in account, when that account is this recipient.
      const me = await getSessionUser().catch(() => null);
      if (me && me.email.toLowerCase() === tokenOwner.email.toLowerCase()) {
        const existing = await db.userSignature.count({ where: { userId: me.id, kind: "signature" } });
        await db.userSignature.create({ data: {
          userId: me.id, kind: "signature", method: adopted.method === "type" ? "type" : adopted.method,
          value: adopted.image ?? name, font: adopted.font, isDefault: existing === 0,
        } }).catch(() => undefined);
      }
    }
    return jsonOk({ ok: true, status: "SIGNED", envelopeStatus: updated.envelope.status,
      sealed: updated.sealed, code: updated.envelope.publicCode, signedAt: actionAt.toISOString() });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[sign POST]", error);
    return jsonError("Signing failed. Please try again.", 500);
  }
}
