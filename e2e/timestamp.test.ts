/// <reference types="bun-types" />

/**
 * RFC 3161 seal timestamps (src/lib/tsa.ts), against a real TSA: a local
 * OpenSSL `ts -reply` authority with its own root, so every token is checked
 * the way an auditor would, with `openssl ts -verify`.
 *
 * Hermetic: scratch SQLite schema, in-process signing route, loopback TSA.
 *
 * Run: bun test e2e/timestamp.test.ts   (run.sh runs it with the hermetic suites)
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { Database } from "bun:sqlite";
import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";

const DIR = mkdtempSync(join(tmpdir(), "tsa-e2e-"));
const P = (name: string) => join(DIR, name).replace(/\\/g, "/");
process.env.DATABASE_URL = `file:${P("scratch.db")}`;
process.env.STORAGE_DIR = P("storage");
for (const k of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT", "S3_SSE_KMS_KEY_ID"]) delete process.env[k];
process.env.REKOR_WITNESS = "off";
process.env.DOCURAMA_ALLOW_PRIVATE_WEBHOOKS = "1"; // loopback TSA, non-production only
delete process.env.SEAL_TIMESTAMPS;
delete process.env.EVIDENCE_PORTAL_URL;
new Database(P("scratch.db"), { create: true }).close();
execFileSync("node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });

/* ── A real RFC 3161 authority: OpenSSL `ts -reply` behind a loopback server ── */

const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: DIR, stdio: "pipe" });

/* The CA's own services, as its certificates advertise them (AIA): an OCSP
   responder (OpenSSL's) and the CA certificate for chain building. */
let ocspMode: "ok" | "down" = "ok";
let ocspRequests = 0;
const pki = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/ca.der") return new Response(readFileSync(P("ca.der")), { headers: { "content-type": "application/pkix-cert" } });
    if (url.pathname !== "/ocsp") return new Response("not found", { status: 404 });
    ocspRequests++;
    if (ocspMode === "down") return new Response("down", { status: 503 });
    const name = `ocsp${ocspRequests}`;
    writeFileSync(P(`${name}.req`), Buffer.from(await req.arrayBuffer()));
    openssl("ocsp", "-index", P("index.txt"), "-rsigner", P("ca.pem"), "-rkey", P("ca.key"), "-CA", P("ca.pem"),
      "-reqin", P(`${name}.req`), "-respout", P(`${name}.resp`), "-ndays", "1");
    return new Response(readFileSync(P(`${name}.resp`)), { headers: { "content-type": "application/ocsp-response" } });
  },
});
const PKI = `http://127.0.0.1:${pki.port}`;

openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", P("ca.key"), "-out", P("ca.pem"), "-days", "2",
  "-subj", "/CN=Docurama Test TSA Root", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
openssl("x509", "-in", P("ca.pem"), "-outform", "DER", "-out", P("ca.der"));
openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", P("tsa.key"), "-out", P("tsa.csr"), "-subj", "/CN=Docurama Test TSA");
writeFileSync(P("tsa.ext"), "basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,timeStamping\n" +
  `authorityInfoAccess=OCSP;URI:${PKI}/ocsp,caIssuers;URI:${PKI}/ca.der\n`);
openssl("x509", "-req", "-in", P("tsa.csr"), "-CA", P("ca.pem"), "-CAkey", P("ca.key"), "-CAcreateserial", "-out", P("tsa.pem"), "-days", "2", "-extfile", P("tsa.ext"));
// The certificate the TSA rotates to later (archive timestamp renewal): it outlives the first one.
openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", P("tsa2.key"), "-out", P("tsa2.csr"), "-subj", "/CN=Docurama Test TSA 2");
openssl("x509", "-req", "-in", P("tsa2.csr"), "-CA", P("ca.pem"), "-CAkey", P("ca.key"), "-CAcreateserial", "-out", P("tsa2.pem"), "-days", "30", "-extfile", P("tsa.ext"));
// OpenSSL's CA database: both TSA certificates are valid (V).
writeFileSync(P("index.txt"), ["tsa", "tsa2"].map((name) => {
  const cert = new X509Certificate(readFileSync(P(`${name}.pem`)));
  const yymmdd = new Date(cert.validTo).toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z";
  return `V\t${yymmdd}\t\t${cert.serialNumber}\tunknown\t${cert.subject.replace(/^/, "/")}\n`;
}).join(""));
writeFileSync(P("tsaserial"), "01\n");
/** Point the TSA at one of its certificates (what `openssl ts -reply` signs with). */
function signWithTsaCert(name: "tsa" | "tsa2") {
  writeFileSync(P("tsa.cnf"), [
    "[ tsa ]", "default_tsa = tsa_config1", "[ tsa_config1 ]",
    `serial = ${P("tsaserial")}`, "crypto_device = builtin", `signer_cert = ${P(`${name}.pem`)}`, `certs = ${P(`${name}.pem`)}`,
    `signer_key = ${P(`${name}.key`)}`, "signer_digest = sha256", "default_policy = 1.3.6.1.4.1.4146.2.3",
    "digests = sha256, sha384, sha512", "accuracy = secs:1", "ordering = no", "tsa_name = yes",
    "ess_cert_id_chain = no", "ess_cert_id_alg = sha256", "",
  ].join("\n"));
}
signWithTsaCert("tsa");

let mode: "ok" | "http-500" | "other-digest" = "ok";
let requests = 0;
const tsaServer = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(req) {
    requests++;
    if (mode === "http-500") return new Response("down", { status: 500 });
    let query = Buffer.from(await req.arrayBuffer());
    if (mode === "other-digest") {
      openssl("ts", "-query", "-digest", "ff".repeat(32), "-sha256", "-cert", "-out", P("other.tsq"));
      query = readFileSync(P("other.tsq"));
    }
    const name = `q${requests}`;
    writeFileSync(P(`${name}.tsq`), query);
    openssl("ts", "-reply", "-config", P("tsa.cnf"), "-queryfile", P(`${name}.tsq`), "-out", P(`${name}.tsr`));
    return new Response(readFileSync(P(`${name}.tsr`)), { headers: { "content-type": "application/timestamp-reply" } });
  },
});
const TSA_URL = `http://127.0.0.1:${tsaServer.port}/tsa`;
process.env.SEAL_TSA_URL = TSA_URL;

const db = new PrismaClient();
const tsa = await import("../src/lib/tsa");
const { verifyEnvelopeCode } = await import("../src/lib/verify");
const { buildEvidencePack } = await import("../src/lib/evidence-pack");
const signRoute = await import("../src/app/api/sign/[token]/route");
const { storeUpload } = await import("../src/lib/document-store");
const { sealedPdfBytes, maintainSealedPdfs } = await import("../src/lib/signed-pdf");
const { signedPdfRevisions } = await import("../src/lib/seal-shared");
const { inspectPdfSignature } = await import("../src/lib/pades");

afterAll(async () => {
  tsaServer.stop(true);
  pki.stop(true);
  await db.$disconnect();
  await (await import("../src/lib/db")).db.$disconnect();
});

beforeEach(() => { mode = "ok"; ocspMode = "ok"; process.env.SEAL_TSA_URL = TSA_URL; delete process.env.SEAL_TIMESTAMPS; });

const DAY = 24 * 60 * 60_000;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** openssl ts -verify on the file's last document timestamp: it covers the whole file and chains to our root. */
function lastArchiveTimestampVerifies(pdf: Buffer): boolean {
  const text = pdf.toString("latin1");
  const ranges = [...text.matchAll(/\/ByteRange \[(\d+) (\d+) (\d+) (\d+)/g)].map((m) => m.slice(1, 5).map(Number));
  const [a, b, c, d] = ranges[ranges.length - 1];
  if (c + d !== pdf.length) return false;
  const id = randomBytes(4).toString("hex");
  writeFileSync(P(`${id}.data`), Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]));
  const token = Buffer.from(text.slice(b + 1, c - 1), "hex");
  writeFileSync(P(`${id}.tst`), token.subarray(0, token.readUIntBE(2, token[1] & 0x7f) + 2 + (token[1] & 0x7f)));
  try {
    return openssl("ts", "-verify", "-data", P(`${id}.data`), "-in", P(`${id}.tst`), "-token_in", "-CAfile", P("ca.pem")).toString().includes("Verification: OK");
  } catch {
    return false;
  }
}

/** openssl ts -verify: the token covers `data` and chains to our TSA root. */
function opensslVerifies(token: Buffer, data: string): boolean {
  const id = randomBytes(4).toString("hex");
  writeFileSync(P(`${id}.tst`), token);
  writeFileSync(P(`${id}.data`), data);
  try {
    return openssl("ts", "-verify", "-data", P(`${id}.data`), "-in", P(`${id}.tst`), "-token_in", "-CAfile", P("ca.pem"))
      .toString().includes("Verification: OK");
  } catch {
    return false;
  }
}

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const tenant = await db.tenant.create({ data: { name: "StålFe AB", slug: `stalfe-tsa-${Date.now()}`, planCode: "BUSINESS", status: "ACTIVE" } });
const sender = await db.user.create({
  data: { email: `alex.tsa.${Date.now()}@stalfe.example`, passwordHash: "fixture-not-a-credential", firstName: "Alexandra", lastName: "Fischer", role: "WORKSPACE_ADMIN", status: "ACTIVE" },
});
let seq = 0;

async function sealedEnvelope(opts: { withPdf?: boolean } = {}) {
  const token = randomBytes(24).toString("base64url");
  const code = `DOC-TSA${String(++seq).padStart(4, "0")}`;
  let documentId: string | undefined;
  if (opts.withPdf) {
    const nda = readFileSync("e2e/fixtures/mutual-nda-two-party.pdf");
    const stored = await storeUpload((async function* () { yield nda; })(), tenant.id);
    documentId = (await db.document.create({
      data: { id: stored.docId, tenantId: tenant.id, uploadedById: sender.id, filename: "nda.pdf", storageKey: stored.storageKey, byteSize: stored.byteSize, pageCount: 2, sha256: stored.sha256 },
    })).id;
  }
  const env = await db.envelope.create({
    data: {
      publicCode: code, title: "Bon de commande PO-2026-0418", titleLower: "bon de commande po-2026-0418",
      tenantId: tenant.id, createdById: sender.id, status: "SENT", pages: 1, documentId,
      recipients: { create: [{ name: "Marco Bianchi", email: "m.bianchi@bianchi-meccanica.example", role: "SIGNER", order: 1, accessToken: token }] },
      events: { create: [{ actor: "Alexandra Fischer", action: "SENT", detail: "Sent to 1 signer" }] },
    },
  });
  const req = new NextRequest(`https://app.docurama.test/api/sign/${token}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "sign", name: "Marco Bianchi" }),
  });
  const res = await signRoute.POST(req, { params: Promise.resolve({ token }) });
  expect(res.status).toBe(200);
  return { id: env.id, code };
}

/* ── Protocol ──────────────────────────────────────────────────────────────── */

describe("RFC 3161 client", () => {
  test("the TimeStampReq is valid DER that OpenSSL reads back (imprint, nonce, certReq)", () => {
    const imprint = createHash("sha256").update("docurama").digest();
    writeFileSync(P("mine.tsq"), tsa.buildTimeStampReq(imprint, "SHA-256", Buffer.from("0102030405060708", "hex")));
    const text = openssl("ts", "-query", "-in", P("mine.tsq"), "-text").toString();
    expect(text).toContain("Hash Algorithm: sha256");
    // "Message data:" is a hex dump: "0000 - 54 46 9d ... 17 70-...   ascii".
    const dumped = [...text.matchAll(/^\s*[0-9a-f]{4} - ((?:[0-9a-f]{2}[ -]){1,16})/gim)]
      .map((m) => m[1].replace(/[ -]/g, "")).join("");
    expect(dumped).toBe(imprint.toString("hex"));
    expect(text).toMatch(/Nonce: 0x0102030405060708/i);
    expect(text).toContain("Certificate required: yes");
  });

  test("a granted token is parsed, matched to the request and verifies with openssl", async () => {
    for (const hash of ["SHA-256", "SHA-384", "SHA-512"] as const) {
      const ts = await tsa.requestTimestamp(TSA_URL, "seal manifest bytes", hash);
      expect(ts.hash).toBe(hash);
      expect(Math.abs(ts.genTime.getTime() - Date.now())).toBeLessThan(60_000);
      expect(ts.policy).toBe("1.3.6.1.4.1.4146.2.3");
      expect(opensslVerifies(ts.token, "seal manifest bytes")).toBe(true);
      expect(opensslVerifies(ts.token, "other bytes")).toBe(false);
    }
  });

  test("a TSA that timestamps a different digest is rejected", async () => {
    mode = "other-digest";
    await expect(tsa.requestTimestamp(TSA_URL, "what we asked for")).rejects.toThrow(/different digest/);
  });

  test("an HTTP error is reported, not swallowed", async () => {
    mode = "http-500";
    await expect(tsa.requestTimestamp(TSA_URL, "x")).rejects.toThrow(/HTTP 500/);
  });

  test("a TSA URL pointing at a private address is refused (SSRF policy)", async () => {
    // Plain HTTP is allowed for TSAs (signed replies), private destinations never are.
    for (const url of ["https://169.254.169.254/latest", "https://10.0.0.8/tsa", "http://192.168.1.10/tsa", "https://metadata.google.internal/tsa", "ftp://tsa.example/"]) {
      await expect(tsa.requestTimestamp(url, "x")).rejects.toThrow(/TSA URL not allowed/);
    }
  });
});

/* ── Sealing ───────────────────────────────────────────────────────────────── */

describe("every seal is timestamped by the assigned TSA", () => {
  test("the platform TSA timestamps the seal before it is committed: level B-T end to end", async () => {
    const { id, code } = await sealedEnvelope();
    const env = await db.envelope.findUniqueOrThrow({ where: { id } });
    expect(env.sealTimestamp).toBeTruthy();
    expect(env.sealTimestampTsa).toBe(TSA_URL);
    expect(env.conformanceLevel).toBe("B-T");
    expect(opensslVerifies(Buffer.from(env.sealTimestamp!, "base64"), env.sealManifest!)).toBe(true);
    // With SHA-256 the imprint IS the seal digest.
    expect(tsa.parseTimeStampToken(Buffer.from(env.sealTimestamp!, "base64")).imprint).toBe(env.sha256!);
    const event = await db.envelopeEvent.findFirstOrThrow({ where: { envelopeId: id, action: "TIMESTAMPED" } });
    expect(event.detail).toContain("platform TSA");

    const v = await verifyEnvelopeCode(code);
    expect(v.result).toBe("VERIFIED");
    if (v.result === "VERIFIED") {
      expect(v.envelope.conformance).toBe("B-T");
      expect(v.envelope.seal.timestamp).toMatchObject({ tsa: `127.0.0.1:${tsaServer.port}`, hash: "SHA-256" });
      expect(v.envelope.seal.transparency.status).toBe("MATCHES");
    }
  });

  test("a workspace's own enabled TSA takes precedence, with its hash algorithm", async () => {
    process.env.SEAL_TSA_URL = "https://platform-tsa-must-not-be-used.example/";
    await db.tsaConfig.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, url: TSA_URL, hashAlgorithm: "SHA-512", enabled: true },
      update: { url: TSA_URL, hashAlgorithm: "SHA-512", enabled: true },
    });
    try {
      const { id } = await sealedEnvelope();
      const env = await db.envelope.findUniqueOrThrow({ where: { id } });
      expect(tsa.parseTimeStampToken(Buffer.from(env.sealTimestamp!, "base64")).hash).toBe("SHA-512");
      expect(opensslVerifies(Buffer.from(env.sealTimestamp!, "base64"), env.sealManifest!)).toBe(true);
      expect((await db.envelopeEvent.findFirstOrThrow({ where: { envelopeId: id, action: "TIMESTAMPED" } })).detail).toContain("workspace TSA");
    } finally {
      await db.tsaConfig.update({ where: { tenantId: tenant.id }, data: { enabled: false } });
    }
  });

  test("a TSA outage never blocks signing: sealed at B-B, retried at export without breaking the log", async () => {
    mode = "http-500";
    const { id, code } = await sealedEnvelope();
    let env = await db.envelope.findUniqueOrThrow({ where: { id } });
    expect(env.status).toBe("COMPLETED");
    expect(env.sealTimestamp).toBeNull();
    expect(env.conformanceLevel).toBe("B-B");
    expect((await db.envelopeEvent.findFirstOrThrow({ where: { envelopeId: id, action: "TIMESTAMP_FAILED" } })).detail).toContain("HTTP 500");
    let v = await verifyEnvelopeCode(code);
    expect(v.result).toBe("VERIFIED");
    if (v.result === "VERIFIED") expect(v.envelope.seal.timestamp).toBeNull();

    mode = "ok";
    await buildEvidencePack(code, tenant.id);
    env = await db.envelope.findUniqueOrThrow({ where: { id } });
    expect(env.sealTimestamp).toBeTruthy();
    // Already committed at B-B: the level stays so the commitment still matches.
    expect(env.conformanceLevel).toBe("B-B");
    v = await verifyEnvelopeCode(code);
    expect(v.result).toBe("VERIFIED");
    if (v.result === "VERIFIED") {
      expect(v.envelope.seal.timestamp).not.toBeNull();
      expect(v.envelope.seal.transparency.status).toBe("MATCHES");
    }
  });

  test("the evidence pack ships the token and it verifies against the shipped manifest", async () => {
    const { code, id } = await sealedEnvelope();
    const pack = (await buildEvidencePack(code, tenant.id)).bytes;
    const env = await db.envelope.findUniqueOrThrow({ where: { id } });
    const token = Buffer.from(env.sealTimestamp!, "base64");
    expect(pack.indexOf(token)).toBeGreaterThan(0);
    expect(pack.toString("utf8")).toContain('"path": "evidence/seal-timestamp.tsr"');
  });

  test("a swapped token (valid, but for another manifest) fails verification", async () => {
    const a = await sealedEnvelope();
    const b = await sealedEnvelope();
    const other = await db.envelope.findUniqueOrThrow({ where: { id: b.id } });
    const own = await db.envelope.findUniqueOrThrow({ where: { id: a.id } });
    await db.envelope.update({ where: { id: a.id }, data: { sealTimestamp: other.sealTimestamp } });
    try {
      const v = await verifyEnvelopeCode(a.code);
      expect(v.result).toBe("INTEGRITY_FAILED");
      if (v.result === "INTEGRITY_FAILED") expect(v.envelope.seal.mismatches).toEqual(["timestamp"]);
    } finally {
      await db.envelope.update({ where: { id: a.id }, data: { sealTimestamp: own.sealTimestamp } });
    }
  });

  test("the sealed PDF reaches PAdES B-LTA: signature timestamp, validation data, archive timestamp", async () => {
    const before = ocspRequests;
    const { id } = await sealedEnvelope({ withPdf: true });
    const env = await db.envelope.findUniqueOrThrow({ where: { id } });
    expect(env.signedPdfLevel).toBe("PAdES-B-LTA");
    // Upkeep is scheduled: the TSA certificate expires within the renewal window, so at the weekly floor.
    expect(env.signedPdfCheckAt!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect(ocspRequests).toBeGreaterThan(before);
    const pdf = (await sealedPdfBytes(id))!.bytes;
    const report = inspectPdfSignature(pdf);
    expect(report).toMatchObject({ valid: true, coversWholeFile: true, level: "PAdES-B-LTA", signatures: 2 });
    expect(report.timestamp?.imprintMatches).toBe(true);
    expect(report.documentTimestamp?.imprintMatches).toBe(true);
    // The TSA certificate and its root, and one OCSP response for the TSA certificate.
    expect(report.dss).toMatchObject({ ocsps: 1, crls: 0 });
    expect(report.dss!.certs).toBeGreaterThanOrEqual(3);
    expect(Math.abs(report.timestamp!.genTime.getTime() - Date.now())).toBeLessThan(60_000);
    // Two incremental updates on top of the signed revision: the PDF still opens.
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3);

    // OpenSSL checks the archive timestamp over the whole file, up to our CA.
    expect(lastArchiveTimestampVerifies(pdf)).toBe(true);
    const detail = (await db.envelopeEvent.findFirstOrThrow({ where: { envelopeId: id, action: "PDF_SEALED" } })).detail!;
    expect(detail).toContain("PAdES-B-LTA signed PDF");
    expect(detail).toContain("1 OCSP response(s)");
    expect(detail).toContain("archive timestamp");
  });

  test("without revocation data the PDF honestly stays PAdES B-T", async () => {
    ocspMode = "down";
    const { id } = await sealedEnvelope({ withPdf: true });
    const env = await db.envelope.findUniqueOrThrow({ where: { id } });
    expect(env.signedPdfLevel).toBe("PAdES-B-T");
    const report = inspectPdfSignature((await sealedPdfBytes(id))!.bytes);
    expect(report).toMatchObject({ valid: true, level: "PAdES-B-T", dss: null, documentTimestamp: null, signatures: 1 });
    expect((await db.envelopeEvent.findFirstOrThrow({ where: { envelopeId: id, action: "PDF_SEALED" } })).detail).toContain("not raised to B-LT");
    // Retried soon by the upkeep pass, not given up on.
    expect(env.signedPdfCheckAt!.getTime()).toBeGreaterThan(Date.now());
    expect(env.signedPdfCheckAt!.getTime()).toBeLessThan(Date.now() + 60 * 60_000);
  });

  test("SEAL_TIMESTAMPS=off skips timestamping entirely", async () => {
    process.env.SEAL_TIMESTAMPS = "off";
    const before = requests;
    const { id } = await sealedEnvelope();
    expect(requests).toBe(before);
    const env = await db.envelope.findUniqueOrThrow({ where: { id } });
    expect(env.sealTimestamp).toBeNull();
    expect(await db.envelopeEvent.count({ where: { envelopeId: id, action: { in: ["TIMESTAMPED", "TIMESTAMP_FAILED"] } } })).toBe(0);
  });
});

/* ── Long-term upkeep ──────────────────────────────────────────────────────── */

describe("long-term upkeep of signed PDFs (the worker pass)", () => {
  test("a PDF kept at B-T while OCSP was down is raised to B-LTA once it answers; the earlier copy still verifies", async () => {
    ocspMode = "down";
    const { id, code } = await sealedEnvelope({ withPdf: true });
    let env = await db.envelope.findUniqueOrThrow({ where: { id } });
    expect(env.signedPdfLevel).toBe("PAdES-B-T");
    const first = (await sealedPdfBytes(id))!.bytes;

    ocspMode = "ok";
    await maintainSealedPdfs({ now: new Date(Date.now() + 60 * 60_000), limit: 50 });
    env = await db.envelope.findUniqueOrThrow({ where: { id } });
    expect(env.signedPdfLevel).toBe("PAdES-B-LTA");
    const current = (await sealedPdfBytes(id))!.bytes;
    // Incremental: the earlier copy is exactly the start of the new one.
    expect(current.subarray(0, first.length).equals(first)).toBe(true);
    expect(inspectPdfSignature(current)).toMatchObject({ valid: true, coversWholeFile: true, level: "PAdES-B-LTA", signatures: 2 });
    expect(lastArchiveTimestampVerifies(current)).toBe(true);
    expect(env.signedPdfSha256).toBe(sha(current));
    expect(signedPdfRevisions(env.signedPdfRevisions)).toEqual([expect.objectContaining({ sha256: sha(first), bytes: first.length, level: "PAdES-B-T" })]);
    expect((await db.envelopeEvent.findFirstOrThrow({ where: { envelopeId: id, action: "PDF_LTV_EXTENDED" } })).detail)
      .toContain("Raised from PAdES-B-T to PAdES-B-LTA");

    // A copy downloaded before the update still matches on the verify page.
    const v = await verifyEnvelopeCode(code);
    expect(v.result).toBe("VERIFIED");
    if (v.result === "VERIFIED") {
      expect(v.envelope.signedPdf?.sha256).toBe(sha(current));
      expect(v.envelope.signedPdf?.earlier).toEqual([{ sha256: sha(first), level: "PAdES-B-T" }]);
    }
    // The evidence pack ships the current file and lists the earlier copy.
    const pack = (await buildEvidencePack(code, tenant.id)).bytes;
    expect(pack.indexOf(current.subarray(current.length - 2000))).toBeGreaterThan(0);
    expect(pack.toString("utf8")).toContain(sha(first));
  });

  test("the archive timestamp is renewed before its TSA certificate expires, only by a certificate that outlives it", async () => {
    const { id } = await sealedEnvelope({ withPdf: true });
    let env = await db.envelope.findUniqueOrThrow({ where: { id } });
    expect(env.signedPdfLevel).toBe("PAdES-B-LTA");
    const first = (await sealedPdfBytes(id))!.bytes;

    // Due (the TSA certificate expires in 2 days), but the TSA still signs with that certificate:
    // a renewal would extend nothing, so the file is kept and the check moves a week on.
    const due = new Date(env.signedPdfCheckAt!.getTime() + 60_000);
    await maintainSealedPdfs({ now: due, limit: 50 });
    env = await db.envelope.findUniqueOrThrow({ where: { id } });
    expect(env.signedPdfSha256).toBe(sha(first));
    expect(env.signedPdfCheckAt!.getTime()).toBeGreaterThanOrEqual(due.getTime() + 7 * DAY);
    expect(await db.envelopeEvent.count({ where: { envelopeId: id, action: "PDF_ARCHIVE_RENEWED" } })).toBe(0);

    // The TSA has rotated to a certificate valid for 30 days: renewed.
    signWithTsaCert("tsa2");
    try {
      await maintainSealedPdfs({ now: new Date(env.signedPdfCheckAt!.getTime() + 60_000), limit: 50 });
    } finally {
      signWithTsaCert("tsa");
    }
    env = await db.envelope.findUniqueOrThrow({ where: { id } });
    const renewed = (await sealedPdfBytes(id))!.bytes;
    expect(renewed.subarray(0, first.length).equals(first)).toBe(true);
    const report = inspectPdfSignature(renewed);
    expect(report).toMatchObject({ valid: true, coversWholeFile: true, level: "PAdES-B-LTA", signatures: 3 });
    expect(report.dss!.ocsps).toBeGreaterThanOrEqual(1);
    expect(lastArchiveTimestampVerifies(renewed)).toBe(true);
    // Each archive timestamp is its own form field.
    expect(renewed.toString("latin1")).toContain("(Docurama archive timestamp 2)");
    expect((await PDFDocument.load(renewed)).getPageCount()).toBe(3);
    expect(env.signedPdfSha256).toBe(sha(renewed));
    expect(signedPdfRevisions(env.signedPdfRevisions).map((r) => r.sha256)).toEqual([sha(first)]);
    const detail = (await db.envelopeEvent.findFirstOrThrow({ where: { envelopeId: id, action: "PDF_ARCHIVE_RENEWED" } })).detail!;
    expect(detail).toContain("Archive timestamp renewed");
    expect(detail).toContain("1 OCSP response(s)");
    expect(detail).toContain(`first ${first.length} bytes`);
  });

  test("a stored file that no longer matches its fingerprint is never touched", async () => {
    const { id } = await sealedEnvelope({ withPdf: true });
    const env = await db.envelope.findUniqueOrThrow({ where: { id } });
    await db.envelope.update({ where: { id }, data: { signedPdfSha256: "0".repeat(64) } });
    await maintainSealedPdfs({ now: new Date(env.signedPdfCheckAt!.getTime() + 60_000), limit: 50 });
    const after = await db.envelope.findUniqueOrThrow({ where: { id } });
    expect(after.signedPdfKey).toBe(env.signedPdfKey);
    expect(after.signedPdfCheckAt).toBeNull();
    expect((await db.envelopeEvent.findFirstOrThrow({ where: { envelopeId: id, action: "PDF_LTV_FAILED" } })).detail).toContain("no longer matches");
  });
});
