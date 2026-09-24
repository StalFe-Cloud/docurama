/**
 * Envelope seal, format "docurama-seal/2".
 *
 * Envelope.sha256 on a sealed envelope is the SHA-256 of a canonical manifest
 * (src/lib/canonical-json.ts) that binds everything the signature evidence
 * rests on:
 *
 *   - the signed file's own SHA-256 (Document.sha256), or, for an envelope
 *     sent from a template, the SHA-256 of the contract text as sent;
 *   - every recipient: order, name, email, role, authentication method,
 *     final status, signing time and the adopted signature (method, font and
 *     the SHA-256 of the drawn or uploaded image);
 *   - every audit event up to sealing, including its detail and IP hash;
 *   - every placed field with its position and the value the signer entered
 *     or the signing act stamped (signature name, initials, date).
 *
 * Changing any of those records after sealing changes the digest. The digest
 * is committed to the tenant's transparency chain at sealing, and
 * verification rebuilds the manifest from the live records, so an edited
 * database row is reported as "modified after sealing" rather than shown as
 * verified. The canonical manifest is stored alongside (Envelope.sealManifest)
 * and exported in the evidence pack, so anyone can hash it offline and
 * compare the result with the committed digest.
 *
 * Seals made before this format (sealFormat null) are checked by the rules
 * they were made under, and verification says what they do not cover:
 *   - uploads: the digest is the document fingerprint alone;
 *   - templates: the v1 record digest (roster and event actions, no names,
 *     no event details, no field values).
 */
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { canonicalJson } from "@/lib/canonical-json";
import { computeLegacyEnvelopeDigest } from "@/lib/esign";
import { commitmentHash } from "@/lib/transparency";
import { parseTimeStampToken } from "@/lib/tsa";
import { SEAL_FORMAT, type SealCheck, type SealMismatch, type SealScope } from "@/lib/seal-shared";

export { SEAL_FORMAT, SEAL_MISMATCH_LABELS, type SealCheck, type SealMismatch, type SealScope } from "@/lib/seal-shared";

export type SealRecipientInput = {
  order: number; name: string; email: string; role: string;
  authMethod: string; status: string; signedAt: Date | null;
  signatureMethod?: string | null; signatureFont?: string | null; signatureSha256?: string | null;
  signatureImage?: string | null;
};
export type SealEventInput = { at: Date; actor: string; action: string; detail: string | null; ipHash: string | null };

export type SealSource = {
  publicCode: string;
  title: string;
  pages: number;
  createdAt: Date;
  sealedAt: Date;
  documentSha256: string | null;
  /** Template envelopes: the contract text as sent (Envelope.contractText). */
  contractText?: string | null;
  verifiedSenderDomain: string | null;
  recipients: SealRecipientInput[];
  events: SealEventInput[];
  /** Envelope.fields JSON as stored. */
  fields: string | null;
};

export type SealManifest = {
  format: typeof SEAL_FORMAT;
  envelope: { code: string; title: string; pages: number; createdAt: string; sealedAt: string; verifiedSenderDomain: string | null };
  /** `textSha256` is present only for template envelopes with a text snapshot. */
  document: { sha256: string | null; textSha256?: string };
  recipients: {
    order: number; name: string; email: string; role: string; authMethod: string; status: string; signedAt: string | null;
    signature: { method: string; font: string | null; sha256: string } | null;
  }[];
  events: { at: string; actor: string; action: string; detail: string | null; ipHash: string | null }[];
  fields: {
    id: string; type: string; page: number | null; x: number | null; y: number | null;
    width: number | null; height: number | null; recipient: string | null; label: string | null; value: string | null;
  }[];
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** The events a seal covers: everything recorded up to sealing, minus the
 * SEALED event itself (it carries the digest, so it cannot be inside it). */
export function eventsCoveredBySeal<T extends { at: Date; action: string }>(events: T[], sealedAt: Date): T[] {
  return events.filter((e) => e.action !== "SEALED" && e.at.getTime() <= sealedAt.getTime());
}

function manifestFields(raw: string | null): SealManifest["fields"] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && typeof (f as { id?: unknown }).id === "string")
    .map((f) => ({
      id: f.id as string,
      type: str(f.type) ?? "unknown",
      page: num(f.pageNumber),
      x: num(f.x), y: num(f.y), width: num(f.width), height: num(f.height),
      recipient: str(f.recipientEmail)?.toLowerCase() ?? null,
      label: str(f.label),
      value: str(f.value),
    }))
    .sort((a, b) => cmp(a.id, b.id));
}

export function buildSealManifest(src: SealSource): SealManifest {
  return {
    format: SEAL_FORMAT,
    envelope: {
      code: src.publicCode, title: src.title, pages: src.pages,
      createdAt: src.createdAt.toISOString(), sealedAt: src.sealedAt.toISOString(),
      verifiedSenderDomain: src.verifiedSenderDomain,
    },
    document: src.contractText
      ? { sha256: src.documentSha256, textSha256: sha256Hex(src.contractText) }
      : { sha256: src.documentSha256 },
    recipients: src.recipients
      .map((r) => ({
        order: r.order, name: r.name, email: r.email.toLowerCase(), role: r.role,
        authMethod: r.authMethod, status: r.status, signedAt: r.signedAt?.toISOString() ?? null,
        signature: r.signatureMethod && r.signatureSha256
          ? { method: r.signatureMethod, font: r.signatureFont ?? null, sha256: r.signatureSha256 }
          : null,
      }))
      .sort((a, b) => a.order - b.order || cmp(a.email, b.email) || cmp(a.role, b.role) || cmp(a.name, b.name)),
    events: eventsCoveredBySeal(src.events, src.sealedAt)
      .map((e) => ({ at: e.at.toISOString(), actor: e.actor, action: e.action, detail: e.detail, ipHash: e.ipHash }))
      .sort((a, b) => cmp(a.at, b.at) || cmp(a.action, b.action) || cmp(a.actor, b.actor) || cmp(a.detail ?? "", b.detail ?? "")),
    fields: manifestFields(src.fields),
  };
}

/** The canonical bytes that are hashed, stored and exported. */
export function sealManifestJson(manifest: SealManifest): string {
  return canonicalJson(manifest);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sealDigest(manifest: SealManifest): string {
  return sha256Hex(sealManifestJson(manifest));
}

/* ── Verification ──────────────────────────────────────────────────────────── */

/** The envelope shape verification needs (load it with `include: sealCheckInclude`). */
export type SealCheckEnvelope = {
  id: string; tenantId: string; publicCode: string; title: string; pages: number;
  createdAt: Date; sealedAt: Date | null; sha256: string | null; conformanceLevel: string | null;
  verifiedSenderDomain: string | null; fields: string | null; contractText: string | null;
  sealFormat: string | null; sealManifest: string | null;
  sealTimestamp: string | null; sealTimestampTsa: string | null;
  document: { sha256: string } | null;
  recipients: (SealRecipientInput & { id: string })[];
  events: SealEventInput[];
};

export const sealCheckInclude = {
  document: { select: { sha256: true } },
  recipients: true,
  events: true,
} as const;

function diffSections(sealed: SealManifest, live: SealManifest): SealMismatch[] {
  const out: SealMismatch[] = [];
  const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
  if (!same(sealed.envelope, live.envelope)) out.push("envelope");
  if (!same(sealed.document, live.document)) out.push("document");
  if (!same(sealed.recipients, live.recipients)) out.push("signers");
  if (!same(sealed.events, live.events)) out.push("audit-trail");
  if (!same(sealed.fields, live.fields)) out.push("field-values");
  return out;
}

function parseManifest(raw: string | null): SealManifest | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as SealManifest;
    return m && m.format === SEAL_FORMAT ? m : null;
  } catch {
    return null;
  }
}

async function transparencyStatus(e: SealCheckEnvelope): Promise<SealCheck["transparency"]> {
  // The FIRST commitment for the envelope is the one made at sealing. A later
  // entry with a different payload would mean the sealed values were changed
  // and re-committed, which no code path does.
  const first = await db.transparencyEntry.findFirst({
    where: { tenantId: e.tenantId, envelopeId: e.id },
    orderBy: { seq: "asc" },
    select: { seq: true, payloadHash: true },
  });
  if (!first || !e.sealedAt || !e.sha256) return { status: "NOT_COMMITTED", seq: null };
  const expected = commitmentHash({
    code: e.publicCode, sha256: e.sha256, sealedAt: e.sealedAt.toISOString(),
    conformance: e.conformanceLevel, pages: e.pages,
    signerCount: e.recipients.filter((r) => r.role === "SIGNER" && r.status === "SIGNED").length,
  });
  return { status: first.payloadHash === expected ? "MATCHES" : "MISMATCH", seq: first.seq };
}

/**
 * Recompute the seal of a sealed envelope from its live records and compare.
 * Callers must only pass envelopes with sealedAt and sha256 set.
 */
export async function checkEnvelopeSeal(e: SealCheckEnvelope): Promise<SealCheck> {
  if (!e.sealedAt || !e.sha256) throw new Error("checkEnvelopeSeal: envelope is not sealed");
  const signers = e.recipients.filter((r) => r.role === "SIGNER").length;
  const covered = eventsCoveredBySeal(e.events, e.sealedAt);
  const mismatches: SealMismatch[] = [];
  let scope: SealScope[];
  let fieldCount = 0;

  if (e.sealFormat === SEAL_FORMAT) {
    const live = buildSealManifest({
      publicCode: e.publicCode, title: e.title, pages: e.pages, createdAt: e.createdAt, sealedAt: e.sealedAt,
      documentSha256: e.document?.sha256 ?? null, contractText: e.contractText, verifiedSenderDomain: e.verifiedSenderDomain,
      recipients: e.recipients, events: e.events, fields: e.fields,
    });
    fieldCount = live.fields.length;
    scope = live.document.sha256 || live.document.textSha256 ? ["document", "signers", "audit-trail", "field-values"] : ["signers", "audit-trail", "field-values"];
    if (sealDigest(live) !== e.sha256) {
      const sealed = parseManifest(e.sealManifest);
      const sections = sealed && sha256Hex(e.sealManifest!) === e.sha256 ? diffSections(sealed, live) : [];
      mismatches.push(...(sections.length ? sections : ["seal-record" as const]));
    } else if (!e.sealManifest || sha256Hex(e.sealManifest) !== e.sha256) {
      // The records match the seal but the stored copy of the manifest does not.
      mismatches.push("seal-record");
    }
  } else if (e.document) {
    // Legacy upload seal: the digest is the file fingerprint recorded at upload.
    scope = ["document"];
    if (e.document.sha256 !== e.sha256) mismatches.push("document");
  } else {
    // Legacy template seal: the v1 record digest.
    scope = ["signers", "audit-trail"];
    // v1 was computed over the signers only (CC recipients were never in it).
    const v1 = computeLegacyEnvelopeDigest({
      publicCode: e.publicCode, title: e.title, pages: e.pages, createdAt: e.createdAt,
      recipients: e.recipients.filter((r) => r.role === "SIGNER"), events: covered,
    });
    if (v1 !== e.sha256) mismatches.push("seal-record");
  }

  // The seal binds each adopted signature by hash; the image itself must still hash to it.
  for (const r of e.recipients) {
    const image = r.signatureImage ? /^data:image\/(?:png|jpeg);base64,(.+)$/.exec(r.signatureImage) : null;
    if (image && createHash("sha256").update(Buffer.from(image[1], "base64")).digest("hex") !== r.signatureSha256) {
      if (!mismatches.includes("signers")) mismatches.push("signers");
    }
  }

  // Only v2 seals store a manifest: one on a "legacy" envelope means its
  // format was cleared to downgrade it to the weaker legacy rules.
  if (e.sealFormat !== SEAL_FORMAT && e.sealManifest) mismatches.push("seal-record");

  const transparency = await transparencyStatus(e);
  if (transparency.status === "MISMATCH") mismatches.push("transparency-log");

  // The stored RFC 3161 token must still cover this exact manifest.
  let timestamp: SealCheck["timestamp"] = null;
  if (e.sealTimestamp && e.sealManifest) {
    try {
      const ts = parseTimeStampToken(Buffer.from(e.sealTimestamp, "base64"));
      const algo = { "SHA-256": "sha256", "SHA-384": "sha384", "SHA-512": "sha512" }[ts.hash];
      if (createHash(algo).update(e.sealManifest, "utf8").digest("hex") !== ts.imprint) throw new Error("imprint");
      const tsa = e.sealTimestampTsa ? (() => { try { return new URL(e.sealTimestampTsa!).host; } catch { return e.sealTimestampTsa!; } })() : "unknown TSA";
      timestamp = { tsa, at: ts.genTime.toISOString(), hash: ts.hash };
    } catch {
      mismatches.push("timestamp");
    }
  }

  return {
    format: e.sealFormat === SEAL_FORMAT ? SEAL_FORMAT : "legacy",
    integrity: mismatches.length ? "MODIFIED" : "INTACT",
    scope,
    sealDigest: e.sha256,
    documentSha256: e.document?.sha256 ?? null,
    bound: { signers, events: scope.includes("audit-trail") ? covered.length : 0, fields: fieldCount },
    mismatches,
    transparency,
    timestamp,
  };
}
