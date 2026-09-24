/**
 * Verification by public code, shared by verify.docurama.eu (/api/v1/verify),
 * the workspace Verify page and the MCP document_verify tool, so every
 * surface reports the same honest state:
 *
 *   NOT_FOUND          no envelope and no attestation with this code
 *   VERIFIED_ATTESTED  sealed on a self-hosted instance; only its pushed
 *                      fingerprint is known here
 *   VOIDED / NOT_SEALED
 *   INTEGRITY_FAILED   sealed, but the records no longer match the seal
 *   VERIFIED           sealed, and the seal recomputes from the records
 */
import { db } from "@/lib/db";
import { publicRecipient, type PublicRecipient } from "@/lib/serializers";
import { checkEnvelopeSeal, sealCheckInclude } from "@/lib/seal";
import { signedPdfRevisions, type SealCheck } from "@/lib/seal-shared";

type SealedEnvelope = {
  title: string; status: string; sealedAt: string; completedAt: string | null;
  conformance: string | null; sha256: string; tenantName: string; pages: number;
  verifiedSenderDomain: string | null;
  seal: SealCheck;
  /**
   * The PAdES-signed PDF: its hash lets a reader check their copy. `earlier`
   * lists copies superseded by long-term updates, which still verify.
   */
  signedPdf: { sha256: string; level: string | null; signer: string | null; earlier: { sha256: string; level: string | null }[] } | null;
};

export type VerifyResult =
  | { result: "NOT_FOUND"; code: string }
  | { result: "NOT_SEALED"; code: string; title: string; status: string }
  | { result: "VOIDED"; code: string; voidedAt: string | null; voidReason: string | null }
  | { result: "VERIFIED"; code: string; envelope: SealedEnvelope & { signers: PublicRecipient[] } }
  /** The signer roster is withheld: it is part of what no longer matches. */
  | { result: "INTEGRITY_FAILED"; code: string; envelope: SealedEnvelope }
  | {
      result: "VERIFIED_ATTESTED"; code: string;
      attestation: {
        sha256: string; sealedAt: string; completedAt: string | null; conformance: string | null;
        pages: number; signerCount: number; verifiedDomain: string | null;
        instance: { label: string; firstSeenAt: string; attestationCount: number };
        transparency: { chainSeq: number | null; chainEntryHash: string | null; proof: string; checkpoint: string };
      };
    };

export async function verifyEnvelopeCode(rawCode: string): Promise<VerifyResult> {
  const code = rawCode.trim().toUpperCase();
  const e = await db.envelope.findUnique({
    where: { publicCode: code },
    include: { ...sealCheckInclude, tenant: { select: { name: true } } },
  });

  if (!e) {
    // Not a local envelope: maybe a self-hosted instance attested this code to
    // the portal. The portal vouches for the pushed fingerprint only.
    const att = await db.portalAttestation.findUnique({ where: { code }, include: { instance: true } });
    if (!att) return { result: "NOT_FOUND", code };
    return {
      result: "VERIFIED_ATTESTED", code,
      attestation: {
        sha256: att.sha256,
        sealedAt: att.sealedAt.toISOString(),
        completedAt: att.completedAt?.toISOString() ?? null,
        conformance: att.conformance,
        pages: att.pages,
        signerCount: att.signerCount,
        verifiedDomain: att.verifiedDomain,
        instance: {
          label: att.instance.label,
          firstSeenAt: att.instance.firstSeenAt.toISOString(),
          attestationCount: att.instance.attestationCount,
        },
        transparency: {
          chainSeq: att.tSeq,
          chainEntryHash: att.tEntryHash,
          proof: `/api/transparency/proof/${att.code}`,
          checkpoint: "/api/transparency/checkpoint",
        },
      },
    };
  }

  if (e.status === "VOIDED") return { result: "VOIDED", code, voidedAt: e.voidedAt?.toISOString() ?? null, voidReason: e.voidReason };
  if (e.status !== "COMPLETED" || !e.sealedAt || !e.sha256) return { result: "NOT_SEALED", code, title: e.title, status: e.status };

  const seal = await checkEnvelopeSeal(e);
  const envelope: SealedEnvelope = {
    title: e.title, status: e.status, sealedAt: e.sealedAt.toISOString(),
    completedAt: e.completedAt?.toISOString() ?? null,
    conformance: e.conformanceLevel, sha256: e.sha256,
    tenantName: e.tenant.name, pages: e.pages,
    verifiedSenderDomain: e.verifiedSenderDomain,
    seal,
    signedPdf: e.signedPdfSha256 ? {
      sha256: e.signedPdfSha256, level: e.signedPdfLevel, signer: e.signedPdfSigner,
      earlier: signedPdfRevisions(e.signedPdfRevisions).map((r) => ({ sha256: r.sha256, level: r.level })),
    } : null,
  };
  if (seal.integrity === "MODIFIED") return { result: "INTEGRITY_FAILED", code, envelope };
  return {
    result: "VERIFIED", code,
    envelope: { ...envelope, signers: e.recipients.filter((r) => r.status === "SIGNED").map(publicRecipient) },
  };
}
