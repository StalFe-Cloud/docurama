/**
 * Long-term validation for sealed PDFs: PAdES B-LT and B-LTA
 * (ETSI EN 319 142-1).
 *
 * A B-T signature proves who signed and when, but checking it in ten years
 * needs the certificates and their revocation status as they were at signing
 * time: by then CAs may have rotated keys, expired certificates and switched
 * off their OCSP responders. So, after the PAdES signature is made:
 *
 *   B-LT   every certificate involved (the seal identity's chain and the chain
 *          of the TSA that timestamped the signature) and proof that none of
 *          them was revoked (OCSP responses, or CRLs when a CA has no OCSP)
 *          are embedded in a Document Security Store (/DSS), appended as an
 *          incremental update so the signed bytes are untouched;
 *   B-LTA  a document timestamp (/DocTimeStamp, ETSI.RFC3161) is then added
 *          over the whole file, DSS included. It protects the validation
 *          material itself and can be renewed before its TSA certificate
 *          expires, which is how an archive keeps a PDF verifiable for decades.
 *
 * maintainLongTerm() is the later pass (run by the background worker): it
 * raises a file that stayed at B-T or B-LT once the missing proofs can be
 * obtained, and renews B-LTA by adding the previous archive timestamp's
 * validation data and a new archive timestamp over everything.
 *
 * Trust anchors (self-signed roots, and the self-signed workspace evidence key)
 * need no revocation data. When any other certificate's status cannot be
 * obtained, nothing is appended and the level stays B-T: the recorded level is
 * always the level the file actually meets.
 *
 * Network access (OCSP, CRL, CA certificates) goes through src/lib/safe-fetch.ts.
 */
import { createHash, X509Certificate } from "crypto";
import { deflateSync } from "zlib";
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObject, PDFRawStream, PDFRef } from "pdf-lib";
import { algId, body, children, decodeOid, octets, raw, readTlv, seq, splitPemCertificates, pemToDer, want, type Tlv } from "@/lib/der";
import { embeddedSignatures, inspectPdfSignature, type PadesFileLevel } from "@/lib/pades";
import { safeFetchBytes } from "@/lib/safe-fetch";
import { requestTimestamp } from "@/lib/tsa";

const OID = {
  aia: "1.3.6.1.5.5.7.1.1",
  crlDistributionPoints: "2.5.29.31",
  ocsp: "1.3.6.1.5.5.7.48.1",
  caIssuers: "1.3.6.1.5.5.7.48.2",
  basicOcspResponse: "1.3.6.1.5.5.7.48.1.1",
  sha1: "1.3.14.3.2.26",
  signedData: "1.2.840.113549.1.7.2",
  signatureTimeStampToken: "1.2.840.113549.1.9.16.2.14",
};

const sha1 = (b: Buffer) => createHash("sha1").update(b).digest();

/* ── Certificates ──────────────────────────────────────────────────────────── */

type Cert = {
  der: Buffer; x509: X509Certificate; name: string;
  serial: Buffer; issuerDer: Buffer; keyBits: Buffer;
  ocsp: string[]; caIssuers: string[]; crl: string[];
  selfSigned: boolean;
};

function collectUris(buf: Buffer, node: Tlv, out: string[]) {
  if (node.tag === 0x86) { out.push(buf.toString("latin1", node.start, node.end)); return; }
  if (node.tag & 0x20) for (const c of children(buf, node)) collectUris(buf, c, out);
}

function parseCert(der: Buffer): Cert {
  const top = want(readTlv(der, 0), 0x30, "Certificate");
  const tbs = children(der, want(children(der, top)[0], 0x30, "TBSCertificate"));
  const i = tbs[0].tag === 0xa0 ? 1 : 0;
  const serial = Buffer.from(raw(der, want(tbs[i], 0x02, "serialNumber")));
  const issuerDer = Buffer.from(raw(der, want(tbs[i + 2], 0x30, "issuer")));
  const subjectDer = Buffer.from(raw(der, want(tbs[i + 4], 0x30, "subject")));
  const keyBits = Buffer.from(body(der, want(children(der, want(tbs[i + 5], 0x30, "subjectPublicKeyInfo"))[1], 0x03, "subjectPublicKey")).subarray(1));
  const urls = { ocsp: [] as string[], caIssuers: [] as string[], crl: [] as string[] };
  const extensions = tbs.find((n) => n.tag === 0xa3);
  if (extensions) {
    for (const ext of children(der, want(children(der, extensions)[0], 0x30, "extensions"))) {
      const parts = children(der, ext);
      const id = decodeOid(der, parts[0]);
      const value = Buffer.from(body(der, parts[parts.length - 1]));
      if (id === OID.aia) {
        for (const ad of children(value, readTlv(value, 0))) {
          const [method, location] = children(value, ad);
          if (location?.tag !== 0x86) continue;
          const url = value.toString("latin1", location.start, location.end);
          if (decodeOid(value, method) === OID.ocsp) urls.ocsp.push(url);
          else if (decodeOid(value, method) === OID.caIssuers) urls.caIssuers.push(url);
        }
      } else if (id === OID.crlDistributionPoints) {
        collectUris(value, readTlv(value, 0), urls.crl);
      }
    }
  }
  const x509 = new X509Certificate(der);
  const selfSigned = issuerDer.equals(subjectDer) && x509.checkIssued(x509) && x509.verify(x509.publicKey);
  const name = /CN=([^\n]+)/.exec(x509.subject)?.[1] ?? x509.subject.split("\n")[0];
  const httpOnly = (u: string) => /^https?:\/\//i.test(u);
  return {
    der, x509, name, serial, issuerDer, keyBits, selfSigned,
    ocsp: urls.ocsp.filter(httpOnly), caIssuers: urls.caIssuers.filter(httpOnly), crl: urls.crl.filter(httpOnly),
  };
}

/** Certificates from a DER certificate, a PKCS#7 "certs-only" bundle or PEM text. */
function certsFrom(bytes: Buffer): Cert[] {
  const text = bytes.toString("latin1");
  if (text.includes("-----BEGIN CERTIFICATE-----")) return splitPemCertificates(text).map((p) => parseCert(pemToDer(p)));
  const top = readTlv(bytes, 0);
  const kids = children(bytes, top);
  if (kids[0]?.tag === 0x06 && decodeOid(bytes, kids[0]) === OID.signedData) {
    const sd = children(bytes, children(bytes, want(kids[1], 0xa0, "content"))[0]);
    const certs = sd.find((n) => n.tag === 0xa0);
    return certs ? children(bytes, certs).map((n) => parseCert(Buffer.from(raw(bytes, n)))) : [];
  }
  return [parseCert(Buffer.from(raw(bytes, top)))];
}

/** Certificates carried by a CMS SignedData ContentInfo (a signature or a timestamp token). */
export function cmsCertificates(cms: Buffer): Buffer[] {
  const kids = children(cms, want(readTlv(cms, 0), 0x30, "ContentInfo"));
  const sd = children(cms, want(children(cms, want(kids[1], 0xa0, "content"))[0], 0x30, "SignedData"));
  const certs = sd.find((n) => n.tag === 0xa0);
  return certs ? children(cms, certs).map((n) => Buffer.from(raw(cms, n))) : [];
}

/** The RFC 3161 token in a CAdES signature's unsigned attributes, if any. */
export function signatureTimestampToken(cms: Buffer): Buffer | null {
  const kids = children(cms, want(readTlv(cms, 0), 0x30, "ContentInfo"));
  const sd = children(cms, want(children(cms, want(kids[1], 0xa0, "content"))[0], 0x30, "SignedData"));
  const signerInfo = children(cms, want(children(cms, want(sd[sd.length - 1], 0x31, "signerInfos"))[0], 0x30, "SignerInfo"));
  const unsigned = signerInfo.find((n) => n.tag === 0xa1);
  if (!unsigned) return null;
  for (const attr of children(cms, unsigned)) {
    const [type, values] = children(cms, attr);
    if (decodeOid(cms, type) === OID.signatureTimeStampToken) return Buffer.from(raw(cms, children(cms, values)[0]));
  }
  return null;
}

/** The end-entity certificate of a set: the one that issued none of the others. */
function leafOf(certs: Cert[]): Cert | undefined {
  return certs.find((c) => !certs.some((o) => o.der !== c.der && o.x509.checkIssued(c.x509))) ?? certs[0];
}

/** When this timestamp token stops being checkable: the first expiry among the certificates it carries. */
function tokenExpiry(token: Buffer): Date | null {
  const ends = cmsCertificates(token).map((der) => new Date(new X509Certificate(der).validTo).getTime());
  return ends.length ? new Date(Math.min(...ends)) : null;
}

async function buildChain(leaf: Cert, pool: Cert[], notes: string[]): Promise<Cert[]> {
  const chain = [leaf];
  let current = leaf;
  const issues = (c: Cert, candidate: Cert) => { try { return c.x509.checkIssued(candidate.x509) && c.x509.verify(candidate.x509.publicKey); } catch { return false; } };
  for (let depth = 0; depth < 6 && !current.selfSigned; depth++) {
    let issuer = pool.find((c) => c.der !== current.der && issues(current, c));
    for (const url of issuer ? [] : current.caIssuers) {
      try {
        const fetched = certsFrom(await safeFetchBytes(url, { maxBytes: 512 * 1024, label: "CA certificate source" }));
        pool.push(...fetched);
        issuer = fetched.find((c) => issues(current, c));
        if (issuer) break;
      } catch (error) {
        notes.push(`${current.name}: issuer download failed (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    if (!issuer) { notes.push(`${current.name}: issuer certificate not found`); break; }
    chain.push(issuer);
    current = issuer;
  }
  return chain;
}

/* ── Revocation: OCSP (RFC 6960), CRL fallback ─────────────────────────────── */

function ocspRequest(cert: Cert, issuer: Cert): Buffer {
  const certId = seq(algId(OID.sha1), octets(sha1(cert.issuerDer)), octets(sha1(issuer.keyBits)), cert.serial);
  // OCSPRequest { TBSRequest { requestList { Request { CertID } } } }
  return seq(seq(seq(seq(certId))));
}

/** Parse an OCSPResponse for `cert`: its status and the responder's certificates. */
function readOcspResponse(resp: Buffer, cert: Cert): { status: "good" | "revoked" | "unknown"; responderCerts: Buffer[] } {
  const top = children(resp, want(readTlv(resp, 0), 0x30, "OCSPResponse"));
  const status = body(resp, want(top[0], 0x0a, "responseStatus"))[0];
  if (status !== 0) throw new Error(`OCSP responder refused (status ${status})`);
  const rb = children(resp, want(children(resp, want(top[1], 0xa0, "responseBytes"))[0], 0x30, "ResponseBytes"));
  if (decodeOid(resp, rb[0]) !== OID.basicOcspResponse) throw new Error("unsupported OCSP response type");
  const basic = Buffer.from(body(resp, want(rb[1], 0x04, "response")));
  const b = children(basic, want(readTlv(basic, 0), 0x30, "BasicOCSPResponse"));
  const tbs = children(basic, want(b[0], 0x30, "tbsResponseData"));
  const k = tbs[0].tag === 0xa0 ? 1 : 0;
  const responses = want(tbs[k + 2], 0x30, "responses");
  const responderCerts = b[3]?.tag === 0xa0 ? children(basic, children(basic, b[3])[0]).map((n) => Buffer.from(raw(basic, n))) : [];
  for (const single of children(basic, responses)) {
    const [certId, certStatus] = children(basic, single);
    if (!Buffer.from(raw(basic, children(basic, certId)[3])).equals(cert.serial)) continue;
    return { status: certStatus.tag === 0x80 ? "good" : certStatus.tag === 0xa1 ? "revoked" : "unknown", responderCerts };
  }
  throw new Error("the OCSP response does not cover this certificate");
}

/** Check a CRL covers `cert` (same issuer) and does not list it. */
function checkCrl(crl: Buffer, cert: Cert): "good" | "revoked" {
  const tbs = children(crl, want(children(crl, want(readTlv(crl, 0), 0x30, "CertificateList"))[0], 0x30, "TBSCertList"));
  let i = tbs[0].tag === 0x02 ? 1 : 0; // version
  i++; // signature algorithm
  if (!Buffer.from(raw(crl, want(tbs[i], 0x30, "issuer"))).equals(cert.issuerDer)) throw new Error("the CRL is from another issuer");
  i++;
  while (tbs[i] && (tbs[i].tag === 0x17 || tbs[i].tag === 0x18)) i++; // thisUpdate, nextUpdate
  const revoked = tbs[i]?.tag === 0x30 ? children(crl, tbs[i]) : [];
  return revoked.some((entry) => Buffer.from(raw(crl, children(crl, entry)[0])).equals(cert.serial)) ? "revoked" : "good";
}

type ValidationData = { certs: Buffer[]; ocsps: Buffer[]; crls: Buffer[]; complete: boolean };

async function revocationFor(cert: Cert, issuer: Cert, data: ValidationData, notes: string[]) {
  for (const url of cert.ocsp) {
    try {
      const resp = await safeFetchBytes(url, {
        body: ocspRequest(cert, issuer), contentType: "application/ocsp-request", accept: "application/ocsp-response",
        maxBytes: 64 * 1024, label: "OCSP responder",
      });
      const parsed = readOcspResponse(resp, cert);
      if (parsed.status === "good") {
        data.ocsps.push(resp);
        data.certs.push(...parsed.responderCerts);
        return;
      }
      notes.push(`${cert.name}: OCSP status ${parsed.status}`);
      if (parsed.status === "revoked") { data.complete = false; return; }
    } catch (error) {
      notes.push(`${cert.name}: OCSP failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  for (const url of cert.crl) {
    try {
      const crl = await safeFetchBytes(url, { maxBytes: 8 * 1024 * 1024, timeoutMs: 15_000, label: "CRL distribution point" });
      if (checkCrl(crl, cert) === "good") { data.crls.push(crl); return; }
      notes.push(`${cert.name}: listed as revoked in its CRL`);
      data.complete = false;
      return;
    } catch (error) {
      notes.push(`${cert.name}: CRL failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (!cert.ocsp.length && !cert.crl.length) notes.push(`${cert.name}: publishes no OCSP responder or CRL`);
  data.complete = false;
}

/** Everything a validator needs for these certificate chains, and whether it is complete. */
async function validationData(leaves: Cert[], pool: Cert[], notes: string[]): Promise<ValidationData> {
  const data: ValidationData = { certs: [], ocsps: [], crls: [], complete: true };
  for (const leaf of leaves) {
    const chain = await buildChain(leaf, pool, notes);
    data.certs.push(...chain.map((c) => c.der));
    if (!chain[chain.length - 1].selfSigned) data.complete = false;
    for (let i = 0; i < chain.length - 1; i++) await revocationFor(chain[i], chain[i + 1], data, notes);
  }
  const seen = new Set<string>();
  data.certs = data.certs.filter((d) => { const h = sha1(d).toString("hex"); if (seen.has(h)) return false; seen.add(h); return true; });
  return data;
}

/* ── Incremental updates ───────────────────────────────────────────────────── */

type Trailer = { size: number; root: string; info: string | null; id: string | null; prev: number };

function readTrailer(pdf: Buffer): Trailer {
  const text = pdf.toString("latin1", Math.max(0, pdf.length - 4096));
  const startxref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  const trailerAt = text.lastIndexOf("trailer");
  if (!startxref || trailerAt < 0) throw new Error("the PDF has no classic trailer to extend");
  const dict = text.slice(trailerAt, startxref.index);
  const size = /\/Size\s+(\d+)/.exec(dict);
  const root = /\/Root\s+(\d+\s+\d+\s+R)/.exec(dict);
  if (!size || !root) throw new Error("the PDF trailer lacks /Size or /Root");
  return {
    size: Number(size[1]), root: root[1],
    info: /\/Info\s+(\d+\s+\d+\s+R)/.exec(dict)?.[1] ?? null,
    id: /\/ID\s*(\[[^\]]*\])/.exec(dict)?.[1] ?? null,
    prev: Number(startxref[1]),
  };
}

const objectBytes = (num: number, gen: number, content: string | Buffer) =>
  Buffer.concat([Buffer.from(`${num} ${gen} obj\n`, "latin1"), Buffer.isBuffer(content) ? content : Buffer.from(content, "latin1"), Buffer.from("\nendobj\n", "latin1")]);

const streamContent = (data: Buffer) => {
  const packed = deflateSync(data);
  return Buffer.concat([Buffer.from(`<< /Length ${packed.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), packed, Buffer.from("\nendstream", "latin1")]);
};

/** Append objects (num -> content) as a new revision with its own xref section. */
function appendRevision(pdf: Buffer, objects: Map<number, { gen: number; content: string | Buffer }>, trailer: Trailer, newSize: number): Buffer {
  const parts: Buffer[] = [pdf];
  let offset = pdf.length;
  if (pdf[pdf.length - 1] !== 0x0a) { parts.push(Buffer.from("\n")); offset += 1; }
  const offsets = new Map<number, { at: number; gen: number }>();
  for (const [num, o] of [...objects.entries()].sort((a, b) => a[0] - b[0])) {
    const bytes = objectBytes(num, o.gen, o.content);
    offsets.set(num, { at: offset, gen: o.gen });
    parts.push(bytes);
    offset += bytes.length;
  }
  const nums = [...offsets.keys()].sort((a, b) => a - b);
  let xref = "xref\n";
  for (let i = 0; i < nums.length;) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    xref += `${nums[i]} ${j - i + 1}\n`;
    for (let k = i; k <= j; k++) {
      const e = offsets.get(nums[k])!;
      xref += `${String(e.at).padStart(10, "0")} ${String(e.gen).padStart(5, "0")} n \n`;
    }
    i = j + 1;
  }
  const xrefAt = offset;
  xref += `trailer\n<< /Size ${newSize} /Root ${trailer.root}${trailer.info ? ` /Info ${trailer.info}` : ""}${trailer.id ? ` /ID ${trailer.id}` : ""} /Prev ${trailer.prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

/** Serialize an existing object after editing it in memory (pdf-lib model). */
const serialize = (obj: PDFObject) => obj.toString();

/* ── B-LT: the Document Security Store ─────────────────────────────────────── */

async function loadModel(pdf: Buffer) {
  return PDFDocument.load(pdf, { updateMetadata: false });
}

/**
 * Append a /DSS (certificates, OCSP responses, CRLs) and point the catalog at
 * it. An earlier revision's DSS is carried over: its entries stay referenced
 * and identical items are not stored twice.
 */
async function writeDss(pdf: Buffer, data: ValidationData): Promise<Buffer> {
  const trailer = readTrailer(pdf);
  const model = await loadModel(pdf);
  const kept = { Certs: [] as string[], OCSPs: [] as string[], CRLs: [] as string[] };
  const held = new Set<string>();
  const dssEntry = model.catalog.get(PDFName.of("DSS"));
  const previous = dssEntry instanceof PDFRef ? model.context.lookupMaybe(dssEntry, PDFDict) : dssEntry instanceof PDFDict ? dssEntry : undefined;
  for (const key of ["Certs", "OCSPs", "CRLs"] as const) {
    for (const item of previous?.lookupMaybe(PDFName.of(key), PDFArray)?.asArray() ?? []) {
      if (!(item instanceof PDFRef)) continue;
      kept[key].push(item.toString());
      const stream = model.context.lookup(item);
      if (stream instanceof PDFRawStream) held.add(sha1(Buffer.from(decodePDFRawStream(stream).decode())).toString("hex"));
    }
  }
  let next = trailer.size;
  const objects = new Map<number, { gen: number; content: string | Buffer }>();
  const addStream = (bytes: Buffer) => {
    const hash = sha1(bytes).toString("hex");
    if (held.has(hash)) return [];
    held.add(hash);
    const n = next++;
    objects.set(n, { gen: 0, content: streamContent(bytes) });
    return [`${n} 0 R`];
  };
  const certs = [...kept.Certs, ...data.certs.flatMap(addStream)];
  const ocsps = [...kept.OCSPs, ...data.ocsps.flatMap(addStream)];
  const crls = [...kept.CRLs, ...data.crls.flatMap(addStream)];
  const dssNum = next++;
  objects.set(dssNum, {
    gen: 0,
    content: `<< /Type /DSS /Certs [${certs.join(" ")}]${ocsps.length ? ` /OCSPs [${ocsps.join(" ")}]` : ""}${crls.length ? ` /CRLs [${crls.join(" ")}]` : ""} >>`,
  });
  const rootRef = model.context.trailerInfo.Root as PDFRef;
  model.catalog.set(PDFName.of("DSS"), PDFRef.of(dssNum, 0));
  objects.set(rootRef.objectNumber, { gen: rootRef.generationNumber, content: serialize(model.catalog) });
  return appendRevision(pdf, objects, trailer, next);
}

/* ── B-LTA: the document timestamp ─────────────────────────────────────────── */

const DOC_TIMESTAMP_BYTES = 20_000;

async function writeDocumentTimestamp(pdf: Buffer, tsaUrl: string): Promise<{ pdf: Buffer; genTime: Date; token: Buffer }> {
  const trailer = readTrailer(pdf);
  const model = await loadModel(pdf);
  let next = trailer.size;
  const objects = new Map<number, { gen: number; content: string | Buffer }>();
  const zeros = "0".repeat(DOC_TIMESTAMP_BYTES * 2);
  const sigNum = next++;
  const widgetNum = next++;
  // Field names must be unique: renewals add "... 2", "... 3".
  const earlier = (pdf.toString("latin1").match(/\/Type\s*\/DocTimeStamp/g) ?? []).length;
  const fieldName = earlier ? `Docurama archive timestamp ${earlier + 1}` : "Docurama archive timestamp";
  objects.set(sigNum, {
    gen: 0,
    content: `<< /Type /DocTimeStamp /Filter /Adobe.PPKLite /SubFilter /ETSI.RFC3161 /ByteRange [0 /********** /********** /**********] /Contents <${zeros}> >>`,
  });
  const pages = model.getPages();
  const page = pages[pages.length - 1];
  objects.set(widgetNum, {
    gen: 0,
    content: `<< /Type /Annot /Subtype /Widget /FT /Sig /Rect [0 0 0 0] /F 132 /T (${fieldName}) /V ${sigNum} 0 R /P ${page.ref.objectNumber} ${page.ref.generationNumber} R >>`,
  });
  const widget = PDFRef.of(widgetNum, 0);
  const rootRef = model.context.trailerInfo.Root as PDFRef;
  const touched = new Map<string, { ref: PDFRef; obj: PDFObject }>();
  const touch = (ref: PDFRef, obj: PDFObject) => touched.set(ref.toString(), { ref, obj });

  // The page's annotations (inline array, or an array object of its own).
  const annots = page.node.get(PDFName.of("Annots"));
  if (annots instanceof PDFRef) {
    const arr = model.context.lookup(annots, PDFArray);
    arr.push(widget);
    touch(annots, arr);
  } else {
    if (annots instanceof PDFArray) annots.push(widget);
    else page.node.set(PDFName.of("Annots"), model.context.obj([widget]));
    touch(page.ref, page.node);
  }
  // The form's fields (AcroForm inline in the catalog, or an object; Fields likewise).
  const acroEntry = model.catalog.get(PDFName.of("AcroForm"));
  const acro = acroEntry instanceof PDFRef ? model.context.lookup(acroEntry, PDFDict) : acroEntry instanceof PDFDict ? acroEntry : null;
  if (acro) {
    const fields = acro.get(PDFName.of("Fields"));
    if (fields instanceof PDFRef) {
      const arr = model.context.lookup(fields, PDFArray);
      arr.push(widget);
      touch(fields, arr);
    } else if (fields instanceof PDFArray) fields.push(widget);
    else acro.set(PDFName.of("Fields"), model.context.obj([widget]));
    acro.set(PDFName.of("SigFlags"), PDFNumber.of(3));
    touch(acroEntry instanceof PDFRef ? acroEntry : rootRef, acroEntry instanceof PDFRef ? acro : model.catalog);
  } else {
    model.catalog.set(PDFName.of("AcroForm"), model.context.obj({ Fields: [widget], SigFlags: 3 }));
    touch(rootRef, model.catalog);
  }
  for (const { ref, obj } of touched.values()) objects.set(ref.objectNumber, { gen: ref.generationNumber, content: serialize(obj) });

  const out = appendRevision(pdf, objects, trailer, next);
  // Byte range: everything but the /Contents value of the new timestamp.
  const text = out.toString("latin1");
  const contentsStart = text.indexOf(`<${zeros}>`, pdf.length);
  const contentsEnd = contentsStart + zeros.length + 2;
  const br = /\/ByteRange \[0 \/\*{10} \/\*{10} \/\*{10}\]/g;
  br.lastIndex = pdf.length;
  const m = br.exec(text);
  if (contentsStart < 0 || !m) throw new Error("document timestamp placeholder not found");
  const range = [0, contentsStart, contentsEnd, out.length - contentsEnd];
  let byteRange = `/ByteRange [${range.join(" ")}]`;
  if (byteRange.length > m[0].length) throw new Error("byte range does not fit its placeholder");
  byteRange = byteRange.slice(0, -1) + " ".repeat(m[0].length - byteRange.length) + "]";
  out.write(byteRange, m.index, "latin1");
  const ts = await requestTimestamp(tsaUrl, Buffer.concat([out.subarray(0, range[1]), out.subarray(range[2])]), "SHA-256");
  const hex = ts.token.toString("hex");
  if (hex.length > zeros.length) throw new Error("the timestamp token does not fit its placeholder");
  out.write(hex.padEnd(zeros.length, "0"), contentsStart + 1, "latin1");
  return { pdf: out, genTime: ts.genTime, token: ts.token };
}

/* ── Orchestration ─────────────────────────────────────────────────────────── */

export type LtvResult = {
  pdf: Buffer;
  level: "PAdES-B-LTA" | "PAdES-B-LT" | "PAdES-B-T";
  validation: { certs: number; ocsps: number; crls: number };
  archiveTimestamp: Date | null;
  /** When the archive timestamp's TSA certificate expires: renew before then. */
  archiveExpires: Date | null;
  notes: string[];
};

/**
 * Raise a PAdES B-T signed PDF to B-LT, then B-LTA. `signerCms` is the CMS
 * that was embedded; `extraCerts` the seal identity's chain. Never throws:
 * on any gap it returns the input unchanged at B-T, with the reasons.
 */
export async function extendToLongTerm(pdf: Buffer, input: { signerCms: Buffer; extraCerts: Buffer[]; tsaUrl: string }): Promise<LtvResult> {
  const notes: string[] = [];
  const unchanged = (why: string): LtvResult => ({ pdf, level: "PAdES-B-T", validation: { certs: 0, ocsps: 0, crls: 0 }, archiveTimestamp: null, archiveExpires: null, notes: [...notes, why] });
  try {
    const token = signatureTimestampToken(input.signerCms);
    if (!token) return unchanged("no signature timestamp, so no long-term level");
    const signerCerts = cmsCertificates(input.signerCms).map(parseCert);
    const tokenCerts = cmsCertificates(token).map(parseCert);
    const pool = [...signerCerts, ...tokenCerts, ...input.extraCerts.map(parseCert)];
    // Leaves: the seal certificate (first in the CMS) and the TSA's signing certificate.
    const tsaLeaf = leafOf(tokenCerts);
    const leaves = [signerCerts[0], ...(tsaLeaf ? [tsaLeaf] : [])].filter(Boolean);
    const data = await validationData(leaves, pool, notes);
    if (!data.complete) return unchanged("validation data incomplete, kept at B-T");
    const withDss = await writeDss(pdf, data);
    const validation = { certs: data.certs.length, ocsps: data.ocsps.length, crls: data.crls.length };
    return await archive(withDss, input.tsaUrl, validation, notes);
  } catch (error) {
    return unchanged(`long-term validation failed (${error instanceof Error ? error.message : String(error)})`);
  }
}

/** B-LT -> B-LTA: add the document timestamp; on failure the file stays B-LT. */
async function archive(pdf: Buffer, tsaUrl: string, validation: LtvResult["validation"], notes: string[]): Promise<LtvResult> {
  try {
    const archived = await writeDocumentTimestamp(pdf, tsaUrl);
    return { pdf: archived.pdf, level: "PAdES-B-LTA", validation, archiveTimestamp: archived.genTime, archiveExpires: tokenExpiry(archived.token), notes };
  } catch (error) {
    notes.push(`document timestamp failed (${error instanceof Error ? error.message : String(error)})`);
    return { pdf, level: "PAdES-B-LT", validation, archiveTimestamp: null, archiveExpires: null, notes };
  }
}

export type LongTermPass = {
  /** EXTENDED: raised from B-T or B-LT. RENEWED: a new archive timestamp. NONE: file unchanged. */
  action: "EXTENDED" | "RENEWED" | "NONE";
  pdf: Buffer;
  level: PadesFileLevel | null;
  validation: LtvResult["validation"];
  archiveTimestamp: Date | null;
  archiveExpires: Date | null;
  notes: string[];
};

/**
 * The later pass over a stored signed PDF. A B-T or B-LT file is raised as far
 * as the proofs now allow; a B-LTA file whose archive timestamp's TSA
 * certificate expires before `renewBefore` gets the validation data for that
 * timestamp and a new archive timestamp over everything. A renewal is only
 * kept when the new TSA certificate outlives the old one (otherwise it would
 * extend nothing). Every change is an incremental update: the earlier file is
 * a byte-for-byte prefix of the new one. Never throws.
 */
export async function maintainLongTerm(pdf: Buffer, input: { tsaUrl: string | null; renewBefore: Date }): Promise<LongTermPass> {
  const notes: string[] = [];
  const report = inspectPdfSignature(pdf);
  const none = (why?: string, archiveExpires: Date | null = null): LongTermPass => ({
    action: "NONE", pdf, level: report.level, validation: { certs: 0, ocsps: 0, crls: 0 }, archiveTimestamp: null, archiveExpires,
    notes: why ? [...notes, why] : notes,
  });
  try {
    if (!report.valid) return none("the stored PDF's signatures do not verify, so it is left untouched");
    if (report.level === "PAdES-B-B" || !report.level) return none("no signature timestamp: a long-term level cannot be added afterwards");
    const signatures = embeddedSignatures(pdf);
    const archives = signatures.filter((s) => s.subFilter === "ETSI.RFC3161");
    const lastArchive = archives.length ? archives[archives.length - 1].cms : null;
    const expires = lastArchive ? tokenExpiry(lastArchive) : null;

    if (report.level === "PAdES-B-LTA") {
      if (expires && expires > input.renewBefore) return none(undefined, expires);
      if (!input.tsaUrl) return none("no timestamp authority assigned, cannot renew the archive timestamp", expires);
      const tokenCerts = cmsCertificates(lastArchive!).map(parseCert);
      const tsaLeaf = leafOf(tokenCerts);
      if (!tsaLeaf) return none("the archive timestamp carries no TSA certificate", expires);
      const data = await validationData([tsaLeaf], tokenCerts, notes);
      if (!data.complete) return none("validation data for the archive timestamp incomplete, renewal retried later", expires);
      const withDss = await writeDss(pdf, data);
      const renewed = await writeDocumentTimestamp(withDss, input.tsaUrl);
      const newExpires = tokenExpiry(renewed.token);
      if (!newExpires || (expires && newExpires <= expires)) {
        return none(`the TSA's certificate (valid until ${newExpires?.toISOString() ?? "unknown"}) does not outlive the current one, renewal retried later`, expires);
      }
      return {
        action: "RENEWED", pdf: renewed.pdf, level: "PAdES-B-LTA",
        validation: { certs: data.certs.length, ocsps: data.ocsps.length, crls: data.crls.length },
        archiveTimestamp: renewed.genTime, archiveExpires: newExpires, notes,
      };
    }

    if (!input.tsaUrl) return none("no timestamp authority assigned");
    const result = report.level === "PAdES-B-LT"
      ? await archive(pdf, input.tsaUrl, { certs: 0, ocsps: 0, crls: 0 }, notes)
      : await extendToLongTerm(pdf, { signerCms: signatures.find((s) => s.subFilter !== "ETSI.RFC3161")!.cms, extraCerts: [], tsaUrl: input.tsaUrl });
    if (result.level === report.level) return none(result.notes.join("; ") || undefined);
    return { action: "EXTENDED", ...result };
  } catch (error) {
    return none(`long-term pass failed (${error instanceof Error ? error.message : String(error)})`);
  }
}
