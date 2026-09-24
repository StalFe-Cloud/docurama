/**
 * The workspace seal identity: the certificate and key that sign every
 * PAdES-sealed PDF of a workspace (src/lib/pades.ts).
 *
 * Assigned automatically, no setup required:
 *
 *   1. the workspace's ACTIVE sealing certificate, when its key is held by the
 *      server: one issued here (Settings, eSign) or one imported from a CA as
 *      a PKCS#12 file. A CA-issued seal certificate (for example one on the
 *      Adobe Approved Trust List, or a qualified seal certificate from a QTSP)
 *      is what makes Acrobat show the signature as trusted;
 *   2. otherwise the workspace evidence key (src/lib/evidence-key.ts),
 *      created on first use: self-signed, with the DNS-verified sending domain
 *      as subjectAltName. The PDF still proves integrity and time; readers
 *      show the identity as not yet trusted.
 *
 * Keys are stored encrypted at rest (src/lib/key-vault.ts).
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { X509Certificate, createPrivateKey } from "crypto";
import { db } from "@/lib/db";
import { getOrCreateEvidenceKey } from "@/lib/evidence-key";
import { openSecret } from "@/lib/key-vault";
import { splitPemCertificates } from "@/lib/der";

const run = promisify(execFile);

export type SealIdentity = {
  source: "certificate" | "evidence-key";
  certificateId: string | null;
  label: string;
  subject: string;
  issuer: string;
  selfSigned: boolean;
  certificatePem: string;
  chainPems: string[];
  privateKeyPem: string;
  thumbprint: string;
  notAfter: Date;
};

/** One-line distinguished name ("CN=…, O=…") from Node's multi-line form. */
export const oneLineDn = (dn: string) => dn.split("\n").filter(Boolean).join(", ");
const cnOf = (dn: string) => /(?:^|\n)CN=([^\n]+)/.exec(dn)?.[1] ?? oneLineDn(dn);

export function describeCertificate(pem: string) {
  const x = new X509Certificate(pem);
  const details = x.publicKey.asymmetricKeyDetails;
  const keyAlgorithm = x.publicKey.asymmetricKeyType === "rsa"
    ? `RSA-${details?.modulusLength ?? "?"}`
    : `EC ${details?.namedCurve ?? ""}`.trim();
  return {
    x,
    subject: oneLineDn(x.subject),
    commonName: cnOf(x.subject),
    issuer: oneLineDn(x.issuer),
    issuerCommonName: cnOf(x.issuer),
    selfSigned: x.subject === x.issuer,
    serialNumber: x.serialNumber.toUpperCase(),
    thumbprint: x.fingerprint256.toUpperCase(),
    notBefore: new Date(x.validFrom),
    notAfter: new Date(x.validTo),
    keyAlgorithm,
  };
}

/** The identity that signs this workspace's seals right now. */
export async function getSealIdentity(tenantId: string): Promise<SealIdentity> {
  const cert = await db.signingCertificate.findFirst({
    where: { tenantId, purpose: "sealing", status: "ACTIVE", privateKeyEnc: { not: null }, notAfter: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (cert?.certificatePem && cert.privateKeyEnc) {
    try {
      const d = describeCertificate(cert.certificatePem);
      return {
        source: "certificate", certificateId: cert.id,
        label: cert.commonName, subject: d.subject, issuer: d.issuer, selfSigned: d.selfSigned,
        certificatePem: cert.certificatePem, chainPems: splitPemCertificates(cert.chainPem ?? ""),
        privateKeyPem: openSecret(cert.privateKeyEnc), thumbprint: d.thumbprint, notAfter: d.notAfter,
      };
    } catch (error) {
      // An unreadable key must not stop sealing: fall back, loudly.
      console.warn(`[seal-identity] certificate ${cert.id} unusable, using the evidence key:`, error instanceof Error ? error.message : error);
    }
  }
  const key = await getOrCreateEvidenceKey(tenantId);
  const d = describeCertificate(key.certificatePem);
  return {
    source: "evidence-key", certificateId: null,
    label: "Workspace evidence key", subject: d.subject, issuer: d.issuer, selfSigned: true,
    certificatePem: key.certificatePem, chainPems: [], privateKeyPem: key.privateKeyPem,
    thumbprint: d.thumbprint, notAfter: d.notAfter,
  };
}

/** What Settings shows: who signs seals now, without touching any key. */
export async function describeSealIdentity(tenantId: string) {
  const cert = await db.signingCertificate.findFirst({
    where: { tenantId, purpose: "sealing", status: "ACTIVE", privateKeyEnc: { not: null }, notAfter: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, commonName: true, issuer: true, origin: true, notAfter: true, thumbprint: true },
  });
  if (cert) {
    return {
      source: "certificate" as const, certificateId: cert.id, label: cert.commonName, issuer: cert.issuer,
      origin: cert.origin, notAfter: cert.notAfter.toISOString(), thumbprint: cert.thumbprint,
    };
  }
  const key = await db.evidenceKey.findUnique({ where: { tenantId }, select: { thumbprint: true, sanDomain: true, createdAt: true } });
  return {
    source: "evidence-key" as const, certificateId: null, label: "Workspace evidence key",
    issuer: "Self-signed", origin: "automatic", notAfter: null, thumbprint: key?.thumbprint ?? null,
    sanDomain: key?.sanDomain ?? null,
  };
}

export type ImportedBundle = {
  certificatePem: string;
  chainPem: string;
  privateKeyPem: string;
  description: ReturnType<typeof describeCertificate>;
};

/**
 * Open a PKCS#12 (.p12 / .pfx) bundle with OpenSSL and check it can seal:
 * a private key that matches the leaf certificate, RSA or EC, currently valid.
 * The passphrase goes through the environment, never the process arguments.
 */
export async function openPkcs12(bundle: Buffer, passphrase: string): Promise<ImportedBundle> {
  const dir = await mkdtemp(join(tmpdir(), "docurama-p12-"));
  const env = { ...process.env, DOCURAMA_P12_PASS: passphrase };
  const p12 = join(dir, "bundle.p12");
  try {
    await writeFile(p12, bundle);
    const extract = async (legacy: boolean) => {
      const base = ["pkcs12", "-in", p12, "-passin", "env:DOCURAMA_P12_PASS", ...(legacy ? ["-legacy"] : [])];
      await run("openssl", [...base, "-nokeys", "-clcerts", "-out", join(dir, "leaf.pem")], { env });
      await run("openssl", [...base, "-nocerts", "-nodes", "-out", join(dir, "key.pem")], { env });
      await run("openssl", [...base, "-nokeys", "-cacerts", "-out", join(dir, "chain.pem")], { env });
    };
    try {
      await extract(false);
    } catch {
      // Older Windows/macOS exports use RC2/3DES, which OpenSSL 3 keeps in its legacy provider.
      try { await extract(true); } catch {
        throw new Error("The file could not be opened: check the passphrase and that it is a PKCS#12 (.p12 or .pfx) bundle");
      }
    }
    const [leafText, keyText, chainText] = await Promise.all(
      ["leaf.pem", "key.pem", "chain.pem"].map((f) => readFile(join(dir, f), "utf8").catch(() => "")),
    );
    const leaf = splitPemCertificates(leafText)[0];
    const keyPem = /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC )?PRIVATE KEY-----/.exec(keyText)?.[0];
    if (!leaf || !keyPem) throw new Error("The bundle must contain a certificate and its private key");
    const key = createPrivateKey(keyPem);
    if (key.asymmetricKeyType !== "rsa" && key.asymmetricKeyType !== "ec") {
      throw new Error("Only RSA and EC keys can seal PDFs");
    }
    const description = describeCertificate(leaf);
    if (!description.x.checkPrivateKey(key)) throw new Error("The private key does not belong to the certificate");
    const now = Date.now();
    if (description.notAfter.getTime() <= now) throw new Error("This certificate has expired");
    if (description.notBefore.getTime() > now) throw new Error("This certificate is not valid yet");
    return {
      certificatePem: leaf,
      chainPem: splitPemCertificates(chainText).join("\n"),
      privateKeyPem: key.export({ type: "pkcs8", format: "pem" }).toString(),
      description,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
