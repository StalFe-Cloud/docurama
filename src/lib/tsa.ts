/**
 * RFC 3161 trusted timestamps for envelope seals.
 *
 * When an envelope is sealed, the canonical seal manifest (src/lib/seal.ts)
 * is hashed and sent to a Timestamp Authority. The TSA returns a signed
 * TimeStampToken proving the seal existed at `genTime`, independently of
 * Docurama's own clock. With SHA-256 the imprint is the seal digest itself.
 *
 * The TSA is assigned automatically: the workspace's own TSA when it has
 * enabled one (Settings, eSign), otherwise the platform TSA (Admin,
 * Settings; SEAL_TSA_URL overrides it). SEAL_TIMESTAMPS=off disables
 * timestamping, for air-gapped installs and hermetic tests.
 *
 * The token is stored as issued (DER) and exported in the evidence pack as
 * evidence/seal-timestamp.tsr, so anyone can check it offline:
 *
 *   openssl ts -verify -data seal-manifest.json -in seal-timestamp.tsr \
 *     -token_in -CAfile <the TSA's root certificate>
 *
 * The request asks for the TSA certificate inside the token (certReq), so
 * only the TSA's root is needed. This module checks what it can without a
 * trust store: status, imprint, algorithm and nonce. The CMS signature is
 * verified against the TSA root by the command above.
 */
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { safeFetchBytes } from "@/lib/safe-fetch";
import { children, decodeOid, intHex, nullDer, oid, readTlv, seq, tlv, want, type Tlv } from "@/lib/der";

export type TsaHash = "SHA-256" | "SHA-384" | "SHA-512";

const HASH_OID: Record<TsaHash, string> = {
  "SHA-256": "2.16.840.1.101.3.4.2.1",
  "SHA-384": "2.16.840.1.101.3.4.2.2",
  "SHA-512": "2.16.840.1.101.3.4.2.3",
};
const NODE_HASH: Record<TsaHash, string> = { "SHA-256": "sha256", "SHA-384": "sha384", "SHA-512": "sha512" };
const ID_CT_TSTINFO = "1.2.840.113549.1.9.16.1.4";
const TSA_TIMEOUT_MS = 10_000;
const MAX_REPLY_BYTES = 256 * 1024;

/** DigiCert serves RFC 3161 over plain HTTP; its HTTPS endpoint does not answer. */
export const DEFAULT_PLATFORM_TSA = "http://timestamp.digicert.com";

/** TimeStampReq (RFC 3161 §2.4.1): v1, message imprint, nonce, certReq TRUE. */
export function buildTimeStampReq(imprint: Buffer, hash: TsaHash, nonce: Buffer): Buffer {
  const algorithm = seq(oid(HASH_OID[hash]), nullDer());
  const messageImprint = seq(algorithm, tlv(0x04, imprint));
  return seq(
    tlv(0x02, Buffer.from([0x01])),
    messageImprint,
    tlv(0x02, nonce),
    tlv(0x01, Buffer.from([0xff])),
  );
}

/** A positive, minimally encoded 64-bit INTEGER body. */
function newNonce(): Buffer {
  const nonce = randomBytes(8);
  nonce[0] = (nonce[0] & 0x7f) || 0x01;
  return nonce;
}

function decodeGeneralizedTime(buf: Buffer, node: Tlv): Date {
  const text = buf.toString("latin1", node.start, node.end);
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:[.,](\d+))?Z$/.exec(text);
  if (!m) throw new Error("malformed timestamp: genTime");
  const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms));
}

export type ParsedTimestamp = {
  genTime: Date;
  serial: string;
  policy: string;
  hash: TsaHash;
  imprint: string;
  nonce: string | null;
};

/** Read the TSTInfo inside a TimeStampToken (CMS SignedData ContentInfo). */
export function parseTimeStampToken(token: Buffer): ParsedTimestamp {
  const contentInfo = want(readTlv(token, 0), 0x30, "ContentInfo");
  const signedData = want(children(token, want(children(token, contentInfo)[1], 0xa0, "content"))[0], 0x30, "SignedData");
  const encap = want(children(token, signedData)[2], 0x30, "encapContentInfo");
  const [eContentType, eContentWrap] = children(token, encap);
  if (decodeOid(token, want(eContentType, 0x06, "eContentType")) !== ID_CT_TSTINFO) throw new Error("malformed timestamp: not a TSTInfo");
  const octets = want(children(token, want(eContentWrap, 0xa0, "eContent"))[0], 0x04, "eContent");
  const tst = token.subarray(octets.start, octets.end);

  const info = children(tst, want(readTlv(tst, 0), 0x30, "TSTInfo"));
  const policy = decodeOid(tst, want(info[1], 0x06, "policy"));
  const [algorithm, hashed] = children(tst, want(info[2], 0x30, "messageImprint"));
  const algOid = decodeOid(tst, want(children(tst, want(algorithm, 0x30, "hashAlgorithm"))[0], 0x06, "hashAlgorithm"));
  const hash = (Object.keys(HASH_OID) as TsaHash[]).find((k) => HASH_OID[k] === algOid);
  if (!hash) throw new Error(`timestamp uses an unsupported hash (${algOid})`);
  const serial = intHex(tst, want(info[3], 0x02, "serialNumber"));
  const genTime = decodeGeneralizedTime(tst, want(info[4], 0x18, "genTime"));
  // After genTime: accuracy SEQUENCE?, ordering BOOLEAN?, nonce INTEGER?, ...
  const nonceNode = info.slice(5).find((n) => n.tag === 0x02);
  return {
    genTime, serial, policy, hash,
    imprint: tst.subarray(hashed.start, hashed.end).toString("hex"),
    nonce: nonceNode ? intHex(tst, nonceNode) : null,
  };
}

/** Validate a TimeStampResp and return the token it carries. */
export function parseTimeStampResp(resp: Buffer): Buffer {
  const top = want(readTlv(resp, 0), 0x30, "TimeStampResp");
  const [statusInfo, token] = children(resp, top);
  const statusFields = children(resp, want(statusInfo, 0x30, "PKIStatusInfo"));
  const status = resp.readUIntBE(want(statusFields[0], 0x02, "status").start, statusFields[0].end - statusFields[0].start);
  if (status !== 0 && status !== 1) {
    const text = statusFields[1]?.tag === 0x30
      ? children(resp, statusFields[1]).map((s) => resp.toString("utf8", s.start, s.end)).join("; ")
      : "";
    throw new Error(`TSA refused the request (status ${status}${text ? `: ${text}` : ""})`);
  }
  if (!token) throw new Error("TSA granted the request but returned no token");
  return Buffer.from(resp.subarray(token.offset, token.end));
}

/**
 * POST a TimeStampReq (src/lib/safe-fetch.ts: public addresses only). Plain
 * HTTP is admitted because the reply is a signed token checked against our own
 * imprint and nonce (DigiCert and GlobalSign serve RFC 3161 over HTTP only);
 * nothing sensitive is sent, the request carries a hash.
 */
function postTimestampQuery(rawUrl: string, body: Buffer): Promise<Buffer> {
  return safeFetchBytes(rawUrl, {
    body, contentType: "application/timestamp-query", accept: "application/timestamp-reply",
    maxBytes: MAX_REPLY_BYTES, timeoutMs: TSA_TIMEOUT_MS, label: "TSA",
  });
}

export type IssuedTimestamp = ParsedTimestamp & { token: Buffer; tsaUrl: string };

/** Ask `tsaUrl` to timestamp `data`, and check the answer matches the request. */
export async function requestTimestamp(tsaUrl: string, data: Buffer | string, hash: TsaHash = "SHA-256"): Promise<IssuedTimestamp> {
  const imprint = createHash(NODE_HASH[hash]).update(data).digest();
  const nonce = newNonce();
  const token = parseTimeStampResp(await postTimestampQuery(tsaUrl, buildTimeStampReq(imprint, hash, nonce)));
  const parsed = parseTimeStampToken(token);
  if (parsed.hash !== hash || parsed.imprint !== imprint.toString("hex")) throw new Error("TSA timestamped a different digest");
  if (parsed.nonce !== nonce.toString("hex").replace(/^(00)+(?=.)/, "")) throw new Error("TSA reply nonce does not match the request");
  return { ...parsed, token, tsaUrl };
}

/* ── Seal timestamps ───────────────────────────────────────────────────────── */

export type TsaAssignment = { url: string; hash: TsaHash; source: "workspace" | "platform" };

/** Which TSA timestamps this workspace's seals, or null when disabled. */
export async function assignedTsa(tenantId: string): Promise<TsaAssignment | null> {
  if (process.env.SEAL_TIMESTAMPS === "off") return null;
  const own = await db.tsaConfig.findUnique({ where: { tenantId } });
  if (own?.enabled && own.url) {
    const hash = (["SHA-256", "SHA-384", "SHA-512"] as const).find((h) => h === own.hashAlgorithm) ?? "SHA-256";
    return { url: own.url, hash, source: "workspace" };
  }
  const platform = await db.platformSetting.findUnique({ where: { id: "singleton" }, select: { tsaUrl: true } });
  return { url: process.env.SEAL_TSA_URL || platform?.tsaUrl || DEFAULT_PLATFORM_TSA, hash: "SHA-256", source: "platform" };
}

export type SealTimestampOutcome =
  | { status: "TIMESTAMPED"; genTime: Date; tsaUrl: string }
  | { status: "ALREADY" }
  | { status: "SKIPPED"; reason: string }
  | { status: "FAILED"; reason: string };

/**
 * Timestamp a sealed v2 envelope's manifest and record the token. Idempotent;
 * never throws (sealing already succeeded, a timestamp only adds to it).
 * Called right after sealing, and again at evidence-pack export for a seal
 * whose TSA was unreachable at the time.
 */
export async function timestampEnvelopeSeal(envelopeId: string): Promise<SealTimestampOutcome> {
  const e = await db.envelope.findUnique({
    where: { id: envelopeId },
    select: { id: true, tenantId: true, sealFormat: true, sealManifest: true, sealTimestamp: true, conformanceLevel: true, publicCode: true },
  });
  if (!e || !e.sealManifest || e.sealFormat == null) return { status: "SKIPPED", reason: "not a v2 seal" };
  if (e.sealTimestamp) return { status: "ALREADY" };
  const tsa = await assignedTsa(e.tenantId);
  if (!tsa) return { status: "SKIPPED", reason: "timestamping is disabled on this installation" };

  const host = (() => { try { return new URL(tsa.url).host; } catch { return tsa.url; } })();
  try {
    const ts = await requestTimestamp(tsa.url, e.sealManifest, tsa.hash);
    // A trusted timestamp over the seal is what B-T denotes. The level is part
    // of the transparency commitment, so it only moves up while the seal is
    // not committed yet (the normal path: timestamp, then commit). A late
    // timestamp is still stored, verified and exported; the level stays.
    const committed = await db.transparencyEntry.count({ where: { tenantId: e.tenantId, envelopeId: e.id } });
    await db.$transaction([
      db.envelope.update({
        where: { id: e.id },
        data: {
          sealTimestamp: ts.token.toString("base64"), sealTimestampAt: ts.genTime, sealTimestampTsa: tsa.url,
          ...(committed === 0 && (!e.conformanceLevel || e.conformanceLevel === "B-B") ? { conformanceLevel: "B-T" } : {}),
        },
      }),
      db.envelopeEvent.create({
        data: {
          envelopeId: e.id, actor: "Docurama", action: "TIMESTAMPED",
          detail: `RFC 3161 timestamp from ${host} (${tsa.source} TSA): genTime ${ts.genTime.toISOString()}, ` +
            `serial ${ts.serial.slice(0, 24)}, ${tsa.hash} imprint of the seal manifest`,
        },
      }),
    ]);
    if (tsa.source === "platform") await markPlatformTsa(true);
    return { status: "TIMESTAMPED", genTime: ts.genTime, tsaUrl: tsa.url };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await db.envelopeEvent.create({
      data: { envelopeId: e.id, actor: "Docurama", action: "TIMESTAMP_FAILED", detail: `RFC 3161 timestamp from ${host} failed: ${reason.slice(0, 300)}` },
    }).catch(() => undefined);
    if (tsa.source === "platform") await markPlatformTsa(false);
    console.warn(`[tsa] ${e.publicCode}: ${reason}`);
    return { status: "FAILED", reason };
  }
}

/** The admin health view reports what the last real request did. */
async function markPlatformTsa(reachable: boolean) {
  await db.platformSetting.updateMany({ where: { id: "singleton", tsaReachable: !reachable }, data: { tsaReachable: reachable } }).catch(() => undefined);
}
