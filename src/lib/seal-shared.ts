/**
 * Seal types and labels shared by the server (src/lib/seal.ts) and the verify
 * pages. No server imports here: this file ships in the client bundle.
 */

export const SEAL_FORMAT = "docurama-seal/2";

/** What a seal covers, in the order verification surfaces list it. */
export type SealScope = "document" | "signers" | "audit-trail" | "field-values";

/** Parts of the record that can disagree with the seal. Public-safe labels:
 * they name a category, never a person or a value. */
export type SealMismatch = "envelope" | "document" | "signers" | "audit-trail" | "field-values" | "seal-record" | "timestamp" | "transparency-log";

export type SealCheck = {
  /** SEAL_FORMAT, or "legacy" for seals made before signer binding. */
  format: string;
  integrity: "INTACT" | "MODIFIED";
  /** What this seal binds. Legacy seals bind less, and say so. */
  scope: SealScope[];
  sealDigest: string;
  /** SHA-256 of the signed file, for comparing a copy of the PDF. */
  documentSha256: string | null;
  bound: { signers: number; events: number; fields: number };
  mismatches: SealMismatch[];
  transparency: { status: "MATCHES" | "MISMATCH" | "NOT_COMMITTED"; seq: number | null };
  /** RFC 3161 timestamp over the seal manifest, when a TSA issued one. */
  timestamp: { tsa: string; at: string; hash: string } | null;
};

export const SEAL_MISMATCH_LABELS: Record<SealMismatch, string> = {
  envelope: "Envelope details (title, pages or dates)",
  document: "Document fingerprint",
  signers: "Signer records",
  "audit-trail": "Audit trail",
  "field-values": "Field values",
  "seal-record": "Stored seal record",
  timestamp: "RFC 3161 timestamp",
  "transparency-log": "Transparency log commitment",
};

/**
 * Plain-language seal level. Docurama seals the evidence record; it does not
 * embed a PAdES signature in the PDF, so the stored B-* code is shown for what
 * it means here rather than as a PAdES claim.
 */
export function sealLevelLabel(level: string | null | undefined): string {
  if (level === "B-T") return "Sealed, RFC 3161 timestamp";
  if (level === "B-B" || !level) return "Sealed, no trusted timestamp";
  return `Sealed (level ${level} recorded)`;
}

/** An earlier copy of a signed PDF, superseded by a long-term update (it is a prefix of the current file). */
export type SignedPdfRevision = { sha256: string; bytes: number; level: string | null; supersededAt: string };

/** Envelope.signedPdfRevisions (JSON) as a list; tolerant of absent or malformed values. */
export function signedPdfRevisions(json: string | null | undefined): SignedPdfRevision[] {
  try {
    const list = json ? JSON.parse(json) : [];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.sha256 === "string") : [];
  } catch {
    return [];
  }
}
