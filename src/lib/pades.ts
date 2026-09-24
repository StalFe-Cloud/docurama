/**
 * PAdES digital signatures (ETSI EN 319 142-1) for sealed PDFs.
 *
 * The signature is a detached CMS SignedData (ETSI.CAdES.detached) over the
 * PDF's byte ranges, i.e. every byte of the file except the signature value
 * itself, with the PAdES baseline attributes:
 *
 *   - signed: content-type, message-digest and ESS signing-certificate-v2
 *     (binds the signer certificate); no signing-time attribute, the claimed
 *     time is the signature dictionary's /M entry, as PAdES requires;
 *   - unsigned: an RFC 3161 signature-time-stamp over the signature value
 *     when a TSA answers, which makes the signature PAdES B-T. Without it the
 *     signature is B-B, and is reported as such.
 *
 * Any PDF reader validates the result (Acrobat's Signature panel, pdfsig,
 * `openssl cms -verify`). Whether the signer identity shows as trusted
 * depends on the certificate: see src/lib/seal-identity.ts.
 *
 * The CMS is DER-encoded by src/lib/der.ts; signing uses Node's crypto with
 * RSA (PKCS #1 v1.5) or ECDSA keys.
 */
import { createHash, createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify, X509Certificate } from "crypto";
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFString, type PDFDocument, type PDFPage } from "pdf-lib";
import {
  algId, body, children, decodeOid, int, issuerAndSerial, octets, oid, pemToDer, raw, readTlv, seq, setOf, tlv, want,
} from "@/lib/der";
import { parseTimeStampToken, requestTimestamp } from "@/lib/tsa";

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  signatureTimeStampToken: "1.2.840.113549.1.9.16.2.14",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
};

/** Room reserved for the CMS: certificates, a TSA token and its chain fit easily. */
export const SIGNATURE_BYTES = 32_768;
const BYTE_RANGE_PLACEHOLDER = "**********";

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest();

export type PadesLevel = "PAdES-B-T" | "PAdES-B-B";

export type SignerMaterial = { certificatePem: string; chainPems: string[]; privateKeyPem: string };

/**
 * Add an (invisible) signature field whose value is a placeholder signature
 * dictionary. Call before `save({ useObjectStreams: false })`; the placeholder
 * is filled by signPdf().
 */
export function addSignaturePlaceholder(pdf: PDFDocument, page: PDFPage, info: {
  name: string; reason: string; location: string; contactInfo: string; signingTime: Date;
}) {
  const ctx = pdf.context;
  const byteRange = PDFArray.withContext(ctx);
  byteRange.push(PDFNumber.of(0));
  for (let i = 0; i < 3; i++) byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
  const signature = ctx.register(ctx.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "ETSI.CAdES.detached",
    ByteRange: byteRange,
    Contents: PDFHexString.of("0".repeat(SIGNATURE_BYTES * 2)),
    M: PDFString.fromDate(info.signingTime),
    Name: PDFHexString.fromText(info.name),
    Reason: PDFHexString.fromText(info.reason),
    Location: PDFHexString.fromText(info.location),
    ContactInfo: PDFHexString.fromText(info.contactInfo),
  }));
  const widget = ctx.register(ctx.obj({
    Type: "Annot", Subtype: "Widget", FT: "Sig", Rect: [0, 0, 0, 0], F: 132,
    T: PDFHexString.fromText("Docurama seal"), V: signature, P: page.ref,
  }));
  const annots = page.node.lookup(PDFName.of("Annots"));
  if (annots instanceof PDFArray) annots.push(widget);
  else page.node.set(PDFName.of("Annots"), ctx.obj([widget]));
  const acroForm = pdf.catalog.lookup(PDFName.of("AcroForm"));
  if (acroForm instanceof PDFDict) {
    const fields = acroForm.lookup(PDFName.of("Fields"));
    if (fields instanceof PDFArray) fields.push(widget);
    else acroForm.set(PDFName.of("Fields"), ctx.obj([widget]));
    acroForm.set(PDFName.of("SigFlags"), PDFNumber.of(3));
  } else {
    pdf.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [widget], SigFlags: 3 }));
  }
}

/** CMS SignedData (CAdES) over `digest`, with a signature timestamp when a TSA answers. */
async function buildCms(digest: Buffer, signer: SignerMaterial, tsaUrl: string | null) {
  const certDer = pemToDer(signer.certificatePem);
  const chainDers = signer.chainPems.map(pemToDer);
  const { issuer, serial } = issuerAndSerial(certDer);
  const key = createPrivateKey(signer.privateKeyPem);
  const ec = key.asymmetricKeyType === "ec";

  // ESSCertIDv2 { certHash, issuerSerial { GeneralNames { [4] directoryName }, serial } }; SHA-256 is the default hash.
  const essCertIdV2 = seq(octets(sha256(certDer)), seq(seq(tlv(0xa4, issuer)), serial));
  const signedAttrs = setOf(
    seq(oid(OID.contentType), setOf(oid(OID.data))),
    seq(oid(OID.messageDigest), setOf(octets(digest))),
    seq(oid(OID.signingCertificateV2), setOf(seq(seq(essCertIdV2)))),
  );
  // The signature covers the attributes encoded as a SET (tag 0x31); inside
  // SignerInfo they are the same bytes under the implicit [0] tag.
  const signature = nodeSign("sha256", signedAttrs, key);

  let timestamp: { genTime: Date; tsaUrl: string } | null = null;
  let timestampError: string | null = null;
  let unsignedAttrs: Buffer | null = null;
  if (tsaUrl) {
    try {
      const ts = await requestTimestamp(tsaUrl, signature, "SHA-256");
      unsignedAttrs = tlv(0xa1, seq(oid(OID.signatureTimeStampToken), setOf(ts.token)));
      timestamp = { genTime: ts.genTime, tsaUrl };
    } catch (error) {
      timestampError = error instanceof Error ? error.message : String(error);
    }
  }

  const signerInfo = seq(
    int(1),
    seq(issuer, serial),
    algId(OID.sha256),
    Buffer.concat([Buffer.from([0xa0]), signedAttrs.subarray(1)]),
    ec ? algId(OID.ecdsaWithSha256, "absent") : algId(OID.rsaEncryption),
    octets(signature),
    ...(unsignedAttrs ? [unsignedAttrs] : []),
  );
  const signedData = seq(
    int(1),
    setOf(algId(OID.sha256)),
    seq(oid(OID.data)),
    tlv(0xa0, Buffer.concat([certDer, ...chainDers])),
    setOf(signerInfo),
  );
  const cms = seq(oid(OID.signedData), tlv(0xa0, signedData));
  return { cms, timestamp, timestampError };
}

export type SignedPdf = {
  pdf: Buffer;
  level: PadesLevel;
  /** The embedded CMS (for the long-term step, src/lib/ltv.ts). */
  cms: Buffer;
  timestamp: { genTime: Date; tsaUrl: string } | null;
  timestampError: string | null;
};

/** Fill the placeholder added by addSignaturePlaceholder(): byte range, then the CMS. */
export async function signPdf(prepared: Uint8Array, signer: SignerMaterial, opts: { tsaUrl: string | null }): Promise<SignedPdf> {
  const pdf = Buffer.from(prepared);
  const text = pdf.toString("latin1");
  const zeros = "0".repeat(SIGNATURE_BYTES * 2);
  const contentsStart = text.indexOf(`<${zeros}>`);
  if (contentsStart < 0 || text.indexOf(`<${zeros}>`, contentsStart + 1) >= 0) throw new Error("signature placeholder not found exactly once");
  const contentsEnd = contentsStart + zeros.length + 2;
  const byteRangeMatch = /\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/.exec(text);
  if (!byteRangeMatch) throw new Error("byte range placeholder not found");

  const range = [0, contentsStart, contentsEnd, pdf.length - contentsEnd];
  let byteRange = `/ByteRange [${range.join(" ")}]`;
  if (byteRange.length > byteRangeMatch[0].length) throw new Error("byte range does not fit its placeholder");
  byteRange = byteRange.slice(0, -1) + " ".repeat(byteRangeMatch[0].length - byteRange.length) + "]";
  pdf.write(byteRange, byteRangeMatch.index, "latin1");

  const digest = sha256(Buffer.concat([pdf.subarray(0, range[1]), pdf.subarray(range[2])]));
  const { cms, timestamp, timestampError } = await buildCms(digest, signer, opts.tsaUrl);
  const hex = cms.toString("hex");
  if (hex.length > zeros.length) throw new Error(`the signature (${cms.length} bytes) exceeds its ${SIGNATURE_BYTES}-byte placeholder`);
  pdf.write(hex.padEnd(zeros.length, "0"), contentsStart + 1, "latin1");
  return { pdf, level: timestamp ? "PAdES-B-T" : "PAdES-B-B", cms, timestamp, timestampError };
}

/* ── Inspection ────────────────────────────────────────────────────────────── */

export type PadesFileLevel = "PAdES-B-LTA" | "PAdES-B-LT" | PadesLevel;

export type PdfSignatureReport = {
  signatures: number;
  valid: boolean;
  /** The last signature or document timestamp covers every byte of the file. */
  coversWholeFile: boolean;
  digestMatches: boolean;
  signatureValid: boolean;
  subFilter: string | null;
  signer: { subject: string; issuer: string; thumbprint: string } | null;
  level: PadesFileLevel | null;
  timestamp: { genTime: Date; imprintMatches: boolean } | null;
  /** B-LT: the Document Security Store, when present. */
  dss: { certs: number; ocsps: number; crls: number } | null;
  /** B-LTA: the document timestamp over the whole file, when present. */
  documentTimestamp: { genTime: Date; imprintMatches: boolean } | null;
};

type SignatureEntry = { a: number; b: number; c: number; d: number; subFilter: string | null };

/** Every signature dictionary in the file, in file order (one per revision that signs). */
function signatureEntries(text: string): SignatureEntry[] {
  return [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].map((m) => {
    const [a, b, c, d] = m.slice(1, 5).map(Number);
    // The dictionary starts at the nearest "obj" before the byte range.
    const dictStart = text.lastIndexOf(" obj", m.index);
    const subFilter = /\/SubFilter\s*\/([A-Za-z0-9.]+)/.exec(text.slice(Math.max(0, dictStart), m.index))?.[1] ?? null;
    return { a, b, c, d, subFilter };
  });
}

const rangesOf = (file: Buffer, s: SignatureEntry) => Buffer.concat([file.subarray(s.a, s.a + s.b), file.subarray(s.c, s.c + s.d)]);

function contentsOf(text: string, s: SignatureEntry): Buffer {
  const buf = Buffer.from(text.slice(s.b + 1, s.c - 1), "hex");
  return buf.subarray(0, readTlv(buf, 0).end);
}

/** The signatures and document timestamps embedded in a PDF, oldest first, as DER. */
export function embeddedSignatures(file: Buffer): { subFilter: string | null; cms: Buffer }[] {
  const text = file.toString("latin1");
  return signatureEntries(text).map((s) => ({ subFilter: s.subFilter, cms: contentsOf(text, s) }));
}

/** Count /Certs, /OCSPs and /CRLs entries of the latest /DSS dictionary. */
function dssCounts(text: string): PdfSignatureReport["dss"] {
  const at = text.lastIndexOf("/Type /DSS");
  if (at < 0) return null;
  const dict = text.slice(at, text.indexOf(">>", at));
  const count = (key: string) => {
    const m = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(dict);
    return m ? (m[1].match(/\d+\s+\d+\s+R/g) ?? []).length : 0;
  };
  return { certs: count("Certs"), ocsps: count("OCSPs"), crls: count("CRLs") };
}

/**
 * Check a PDF's signatures the way a reader would: each byte range and
 * message digest, the CAdES signature under its embedded certificate, the
 * signature timestamp's imprint, and, for long-term files, the DSS and the
 * document timestamp over the whole file. Trust in the certificates (a chain
 * to a trusted root) is the reader's policy and is not decided here.
 */
export function inspectPdfSignature(file: Buffer): PdfSignatureReport {
  const report: PdfSignatureReport = {
    signatures: 0, valid: false, coversWholeFile: false, digestMatches: false, signatureValid: false,
    subFilter: null, signer: null, level: null, timestamp: null, dss: null, documentTimestamp: null,
  };
  const text = file.toString("latin1");
  const entries = signatureEntries(text);
  report.signatures = entries.length;
  if (!entries.length) return report;
  const last = entries[entries.length - 1];
  report.coversWholeFile = last.a === 0 && last.c + last.d === file.length;
  report.dss = dssCounts(text);

  let allValid = true;
  for (const s of entries) {
    try {
      if (s.a !== 0 || s.c < s.b) { allValid = false; continue; }
      const cms = contentsOf(text, s);
      if (s.subFilter === "ETSI.RFC3161") {
        // Document timestamp: the token's imprint is the hash of the byte ranges.
        const ts = parseTimeStampToken(cms);
        const algo = ts.hash === "SHA-256" ? "sha256" : ts.hash === "SHA-384" ? "sha384" : "sha512";
        const imprintMatches = createHash(algo).update(rangesOf(file, s)).digest("hex") === ts.imprint;
        report.documentTimestamp = { genTime: ts.genTime, imprintMatches };
        if (!imprintMatches) allValid = false;
        continue;
      }
      const ok = checkCadesSignature(file, cms, s, report);
      if (!ok) allValid = false;
    } catch {
      allValid = false;
    }
  }
  const tst = report.timestamp?.imprintMatches === true;
  report.level = !tst ? "PAdES-B-B"
    : report.dss && report.documentTimestamp?.imprintMatches ? "PAdES-B-LTA"
    : report.dss ? "PAdES-B-LT"
    : "PAdES-B-T";
  report.valid = allValid && report.coversWholeFile && report.digestMatches && report.signatureValid;
  return report;
}

/** The (first) CAdES signature: digest, signature and signature timestamp. */
function checkCadesSignature(file: Buffer, cms: Buffer, s: SignatureEntry, report: PdfSignatureReport): boolean {
  const first = report.signer === null;
  const contentInfo = want(readTlv(cms, 0), 0x30, "ContentInfo");
  const [type, wrap] = children(cms, contentInfo);
  if (decodeOid(cms, type) !== OID.signedData) return false;
  const sd = children(cms, want(children(cms, want(wrap, 0xa0, "content"))[0], 0x30, "SignedData"));
  const certs = sd.find((n) => n.tag === 0xa0);
  const signerInfos = sd[sd.length - 1];
  const si = children(cms, want(children(cms, want(signerInfos, 0x31, "signerInfos"))[0], 0x30, "SignerInfo"));
  const attrsNode = want(si[3], 0xa0, "signedAttrs");
  const signatureNode = want(si[5], 0x04, "signature");
  const certDer = certs ? raw(cms, children(cms, certs)[0]) : null;
  if (!certDer) return false;
  const cert = new X509Certificate(Buffer.from(certDer));

  const digest = sha256(rangesOf(file, s));
  let messageDigest: Buffer | null = null;
  for (const attr of children(cms, attrsNode)) {
    const [attrType, values] = children(cms, attr);
    if (decodeOid(cms, attrType) === OID.messageDigest) messageDigest = Buffer.from(body(cms, children(cms, values)[0]));
  }
  const digestMatches = !!messageDigest && messageDigest.equals(digest);
  const signedAttrs = Buffer.from(raw(cms, attrsNode));
  signedAttrs[0] = 0x31;
  const signature = Buffer.from(body(cms, signatureNode));
  const signatureValid = nodeVerify("sha256", signedAttrs, createPublicKey(cert.publicKey.export({ type: "spki", format: "pem" })), signature);

  let timestampOk = true;
  const unsigned = si.find((n) => n.tag === 0xa1);
  if (unsigned) {
    for (const attr of children(cms, unsigned)) {
      const [attrType, values] = children(cms, attr);
      if (decodeOid(cms, attrType) !== OID.signatureTimeStampToken) continue;
      const ts = parseTimeStampToken(Buffer.from(raw(cms, children(cms, values)[0])));
      const imprint = createHash(ts.hash === "SHA-256" ? "sha256" : ts.hash === "SHA-384" ? "sha384" : "sha512").update(signature).digest("hex");
      if (first) report.timestamp = { genTime: ts.genTime, imprintMatches: imprint === ts.imprint };
      if (imprint !== ts.imprint) timestampOk = false;
    }
  }
  if (first) {
    report.signer = { subject: cert.subject.split("\n").join(", "), issuer: cert.issuer.split("\n").join(", "), thumbprint: cert.fingerprint256 };
    report.subFilter = s.subFilter;
    report.digestMatches = digestMatches;
    report.signatureValid = signatureValid;
  }
  return digestMatches && signatureValid && timestampOk;
}
