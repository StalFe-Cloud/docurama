/**
 * Minimal ASN.1 DER encoder and reader for the structures Docurama builds and
 * checks itself: RFC 3161 timestamp requests and tokens (src/lib/tsa.ts) and
 * the CMS SignedData inside PAdES signatures (src/lib/pades.ts).
 *
 * Deliberately small and dependency-free: definite lengths only, single-byte
 * tags, and nothing that is not needed by those two callers.
 */

/* ── Encoding ──────────────────────────────────────────────────────────────── */

function derLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
export const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
/** SET OF: DER sorts the encoded members. */
export const setOf = (...items: Buffer[]) => tlv(0x31, Buffer.concat([...items].sort(Buffer.compare)));
export const octets = (body: Buffer) => tlv(0x04, body);
export const nullDer = () => Buffer.from([0x05, 0x00]);
/** Context-specific constructed tag [n] around already-encoded content. */
export const ctx = (n: number, content: Buffer) => tlv(0xa0 + n, content);

/** INTEGER from a positive big-endian magnitude (a sign byte is added when needed). */
export function int(value: number | Buffer): Buffer {
  let body = typeof value === "number" ? Buffer.from([value]) : value;
  if (typeof value === "number" && value > 0xff) {
    const bytes: number[] = [];
    for (let v = value; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
    body = Buffer.from(bytes);
  }
  let i = 0;
  while (i < body.length - 1 && body[i] === 0 && body[i + 1] < 0x80) i++;
  body = body.subarray(i);
  if (body[0] & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
  return tlv(0x02, body);
}

export function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [];
    let v = part;
    do { chunk.unshift(v & 0x7f); v = Math.floor(v / 128); } while (v > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

/** AlgorithmIdentifier; `params: "null"` appends an explicit NULL. */
export const algId = (dotted: string, params: "null" | "absent" = "null") =>
  params === "null" ? seq(oid(dotted), nullDer()) : seq(oid(dotted));

/* ── Reading ───────────────────────────────────────────────────────────────── */

export type Tlv = { tag: number; offset: number; start: number; end: number };

export function readTlv(buf: Buffer, offset: number): Tlv {
  if (offset + 2 > buf.length) throw new Error("truncated DER");
  const tag = buf[offset];
  if ((tag & 0x1f) === 0x1f) throw new Error("unsupported DER tag");
  let p = offset + 1;
  let length = buf[p++];
  if (length & 0x80) {
    const n = length & 0x7f;
    if (n === 0 || n > 4) throw new Error("unsupported DER length");
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + buf[p++];
  }
  const end = p + length;
  if (end > buf.length) throw new Error("truncated DER");
  return { tag, offset, start: p, end };
}

export function children(buf: Buffer, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let p = parent.start; p < parent.end;) {
    const child = readTlv(buf, p);
    out.push(child);
    p = child.end;
  }
  return out;
}

/** The complete encoding (tag, length and body) of a node. */
export const raw = (buf: Buffer, node: Tlv) => buf.subarray(node.offset, node.end);
/** The body of a node. */
export const body = (buf: Buffer, node: Tlv) => buf.subarray(node.start, node.end);

export function want(node: Tlv | undefined, tag: number, what: string): Tlv {
  if (!node || node.tag !== tag) throw new Error(`malformed DER: ${what}`);
  return node;
}

export function decodeOid(buf: Buffer, node: Tlv): string {
  const bytes = buf.subarray(node.start, node.end);
  const first = bytes[0];
  const parts = [first < 80 ? Math.floor(first / 40) : 2, first < 80 ? first % 40 : first - 80];
  let v = 0;
  for (const b of bytes.subarray(1)) {
    v = v * 128 + (b & 0x7f);
    if (!(b & 0x80)) { parts.push(v); v = 0; }
  }
  return parts.join(".");
}

/** INTEGER body as lowercase hex without leading zero bytes. */
export const intHex = (buf: Buffer, node: Tlv) => buf.subarray(node.start, node.end).toString("hex").replace(/^(00)+(?=.)/, "");

/* ── X.509 pieces CMS needs ────────────────────────────────────────────────── */

/** DER of a PEM certificate. */
export function pemToDer(pem: string): Buffer {
  const m = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(pem);
  if (!m) throw new Error("not a PEM certificate");
  return Buffer.from(m[1].replace(/\s+/g, ""), "base64");
}

/** Every certificate in a PEM bundle, in order. */
export function splitPemCertificates(pem: string): string[] {
  return pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
}

/** The issuer Name and serialNumber INTEGER, as encoded in the certificate. */
export function issuerAndSerial(certDer: Buffer): { issuer: Buffer; serial: Buffer } {
  const cert = want(readTlv(certDer, 0), 0x30, "Certificate");
  const tbs = want(children(certDer, cert)[0], 0x30, "TBSCertificate");
  const fields = children(certDer, tbs);
  const i = fields[0].tag === 0xa0 ? 1 : 0; // explicit [0] version is optional
  const serial = want(fields[i], 0x02, "serialNumber");
  const issuer = want(fields[i + 2], 0x30, "issuer");
  return { issuer: Buffer.from(raw(certDer, issuer)), serial: Buffer.from(raw(certDer, serial)) };
}
