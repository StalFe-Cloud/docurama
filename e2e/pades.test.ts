/// <reference types="bun-types" />

/**
 * Sealed PDFs (src/lib/signed-pdf.ts, src/lib/pades.ts), adopted signatures
 * and the workspace seal identity (src/lib/seal-identity.ts).
 *
 * Hermetic: a scratch SQLite schema and storage directory, the real signing
 * route called in process, the NDA fixture placed by the real field detector
 * exactly as the builder places it. Every signed PDF is checked twice: by our
 * own inspector and independently by `openssl cms -verify`.
 *
 * RFC 3161 signature timestamps (PAdES B-T) are covered in e2e/timestamp.test.ts.
 *
 * Run: bun test e2e/pades.test.ts   (run.sh runs it with the hermetic suites)
 */

import { afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { Database } from "bun:sqlite";
import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";

const DIR = mkdtempSync(join(tmpdir(), "pades-e2e-"));
const P = (name: string) => join(DIR, name).replace(/\\/g, "/");
process.env.DATABASE_URL = `file:${P("scratch.db")}`;
process.env.STORAGE_DIR = P("storage");
process.env.REKOR_WITNESS = "off";
process.env.SEAL_TIMESTAMPS = "off";
process.env.DOCURAMA_KEY_ENCRYPTION_KEY = randomBytes(32).toString("hex");
for (const k of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT", "S3_SSE_KMS_KEY_ID", "EVIDENCE_PORTAL_URL"]) delete process.env[k];
new Database(P("scratch.db"), { create: true }).close();
execFileSync("node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });

const db = new PrismaClient();
const { storeUpload } = await import("../src/lib/document-store");
const { extractDocument } = await import("../src/lib/docintel/text-extract");
const { detectFields } = await import("../src/lib/docintel/field-detector");
const { assignFieldsToSigners } = await import("../src/lib/docintel/assign-signers");
const { inspectPdfSignature } = await import("../src/lib/pades");
const { sealedPdfBytes } = await import("../src/lib/signed-pdf");
const { getSealIdentity } = await import("../src/lib/seal-identity");
const { verifyEnvelopeCode } = await import("../src/lib/verify");
const { buildEvidencePack } = await import("../src/lib/evidence-pack");
const { postSettingsOp } = await import("../src/lib/settings-handlers");
const signRoute = await import("../src/app/api/sign/[token]/route");
const signedPdfRoute = await import("../src/app/api/sign/[token]/signed-pdf/route");

afterAll(async () => {
  await db.$disconnect();
  await (await import("../src/lib/db")).db.$disconnect();
});

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: DIR, stdio: "pipe" }).toString();

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const NDA = readFileSync("e2e/fixtures/mutual-nda-two-party.pdf");
const tenant = await db.tenant.create({ data: { name: "StålFe AB", slug: `stalfe-pades-${Date.now()}`, planCode: "BUSINESS", status: "ACTIVE" } });
const owner = await db.user.create({
  data: { email: `alex.pades.${Date.now()}@stalfe.example`, passwordHash: "fixture-not-a-credential", firstName: "Alexandra", lastName: "Fischer", role: "WORKSPACE_ADMIN", status: "ACTIVE" },
});
await db.member.create({ data: { userId: owner.id, tenantId: tenant.id, role: "OWNER", status: "ACTIVE" } });
const me = {
  id: owner.id, email: owner.email, firstName: "Alexandra", lastName: "Fischer", role: "WORKSPACE_ADMIN", totpEnabled: false,
  tenantId: tenant.id, tenantName: tenant.name, tenantSlug: tenant.slug, tenantPlan: "BUSINESS", workspaceRole: "OWNER", sessionId: null, orgs: [],
};
const settingsOp = async (op: string, data: Record<string, unknown> = {}, id?: string) => {
  const res = await postSettingsOp(me, { op, data, id }, new NextRequest("https://app.docurama.test/api/workspace/settings", { method: "POST" }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

const SIGNERS = [
  { name: "Camille Laurent", email: "camille.laurent@stalfe.example", title: "Directrice qualité" },
  { name: "Jonas Weber", email: "jonas.weber@nordlicht.example", title: "Geschäftsführer" },
];

/** Where the builder's AI auto-detect puts the fields on the NDA (same conversion as document-builder.tsx). */
const detected = await detectFields(await extractDocument(new Uint8Array(NDA)), new Uint8Array(NDA));
const owners = assignFieldsToSigners(detected, 2);
const FIELDS = detected.map((f, i) => {
  const wPct = Math.min(40, Math.max(12, Math.round((f.width / 595) * 100 * 10) / 10));
  const hPct = Math.min(12, Math.max(3.5, Math.round((f.height / 842) * 100 * 10) / 10));
  return {
    id: `f${i}`, type: f.fieldType, pageNumber: f.pageNumber, label: f.label ?? f.fieldType,
    x: Math.max(2, Math.min(95 - wPct, f.x)), y: Math.max(2, Math.min(96 - hPct, f.y)), width: wPct, height: hPct,
    recipientEmail: SIGNERS[owners[i] ?? 0].email,
  };
});

function drawnSignature(seed = 1): string {
  const canvas = createCanvas(300, 100);
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#0f2a6b";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(10, 70);
  for (let x = 10; x < 290; x += 8) ctx.lineTo(x, 50 + Math.sin(x / (12 + seed)) * 25);
  ctx.stroke();
  return `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
}

let seq = 0;
async function sentEnvelope() {
  const stored = await storeUpload((async function* () { yield NDA; })(), tenant.id);
  const doc = await db.document.create({
    data: { id: stored.docId, tenantId: tenant.id, uploadedById: owner.id, filename: "Mutual-NDA.pdf", storageKey: stored.storageKey, byteSize: stored.byteSize, pageCount: 2, sha256: stored.sha256 },
  });
  const tokens = SIGNERS.map(() => randomBytes(24).toString("base64url"));
  const code = `DOC-PADES${String(++seq).padStart(3, "0")}`;
  const env = await db.envelope.create({
    data: {
      publicCode: code, title: "Mutual NDA, StålFe AB and Nordlicht GmbH", titleLower: "mutual nda", tenantId: tenant.id,
      createdById: owner.id, status: "SENT", pages: 2, documentId: doc.id, sha256: doc.sha256, fields: JSON.stringify(FIELDS),
      recipients: { create: SIGNERS.map((s, i) => ({ name: s.name, email: s.email, role: "SIGNER", order: i + 1, accessToken: tokens[i] })) },
      events: { create: [{ actor: "Alexandra Fischer", action: "SENT", detail: "Sent to 2 signers" }] },
    },
  });
  return { env, doc, tokens, code };
}

async function sign(token: string, body: Record<string, unknown>) {
  const req = new NextRequest(`https://app.docurama.test/api/sign/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const res = await signRoute.POST(req, { params: Promise.resolve({ token }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const textValues = (email: string) => Object.fromEntries(
  FIELDS.filter((f) => f.type === "text" && f.recipientEmail === email).map((f) => {
    const s = SIGNERS.find((x) => x.email === email)!;
    return [f.id, /title/i.test(f.label) ? s.title : s.name];
  }),
);

async function sealedEnvelope(first: Record<string, unknown> = {}, second: Record<string, unknown> = {}) {
  const made = await sentEnvelope();
  expect((await sign(made.tokens[0], { op: "sign", name: SIGNERS[0].name, fieldValues: textValues(SIGNERS[0].email), ...first })).status).toBe(200);
  const done = await sign(made.tokens[1], { op: "sign", name: SIGNERS[1].name, fieldValues: textValues(SIGNERS[1].email), ...second });
  expect(done.status).toBe(200);
  expect(done.json.sealed).toBe(true);
  return made;
}

/** Split a signed PDF into what `openssl cms -verify` needs, and run it. */
function opensslVerifiesPdf(pdf: Buffer): boolean {
  const text = pdf.toString("latin1");
  const [a, b, c, d] = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)/.exec(text)!.slice(1).map(Number);
  const id = randomBytes(4).toString("hex");
  writeFileSync(P(`${id}.content`), Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]));
  const der = Buffer.from(text.slice(b + 1, c - 1), "hex");
  const lenBytes = der[1] & 0x7f;
  writeFileSync(P(`${id}.p7s`), der.subarray(0, (der[1] & 0x80 ? der.readUIntBE(2, lenBytes) + 2 + lenBytes : der[1] + 2)));
  try {
    openssl("cms", "-verify", "-inform", "DER", "-in", P(`${id}.p7s`), "-content", P(`${id}.content`), "-binary", "-noverify", "-out", P(`${id}.out`));
    return true;
  } catch {
    return false;
  }
}

/* ── The sealed PDF ────────────────────────────────────────────────────────── */

describe("sealing an uploaded PDF produces a PAdES-signed copy", () => {
  test("signed by the workspace evidence key, valid for our inspector and for OpenSSL", async () => {
    const { env } = await sealedEnvelope();
    const e = await db.envelope.findUniqueOrThrow({ where: { id: env.id } });
    expect(e.signedPdfKey).toMatch(/^documents\/[^/]+\/sealed_[0-9a-f]{32}\.pdf$/);
    expect(e.signedPdfLevel).toBe("PAdES-B-B"); // no TSA in this suite
    const pdf = (await sealedPdfBytes(env.id))!.bytes;
    expect(sha(pdf)).toBe(e.signedPdfSha256!);
    const report = inspectPdfSignature(pdf);
    expect(report).toMatchObject({ signatures: 1, valid: true, coversWholeFile: true, digestMatches: true, signatureValid: true, subFilter: "ETSI.CAdES.detached" });
    expect(report.signer?.subject).toContain("Docurama Evidence Key - StålFe AB");
    expect(opensslVerifiesPdf(pdf)).toBe(true);
    // Original pages plus the signature certificate page.
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3);
    const ev = await db.envelopeEvent.findFirstOrThrow({ where: { envelopeId: env.id, action: "PDF_SEALED" } });
    expect(ev.detail).toContain("PAdES-B-B signed PDF");
    expect(ev.detail).toContain("Workspace evidence key");
  });

  test("any change to the signed PDF breaks it; an appended revision is reported as not covered", async () => {
    const { env } = await sealedEnvelope();
    const pdf = (await sealedPdfBytes(env.id))!.bytes;
    // One bit, well inside the first signed byte range (page content is compressed, so no text search).
    const flipped = Buffer.from(pdf);
    const firstRangeEnd = Number(/\/ByteRange \[0 (\d+)/.exec(pdf.toString("latin1"))![1]);
    flipped[Math.floor(firstRangeEnd / 2)] ^= 0x01;
    expect(inspectPdfSignature(flipped).valid).toBe(false);
    expect(opensslVerifiesPdf(flipped)).toBe(false);
    const appended = Buffer.concat([pdf, Buffer.from("\n1 0 obj\n<< /Evil true >>\nendobj\n")]);
    expect(inspectPdfSignature(appended)).toMatchObject({ coversWholeFile: false, valid: false });
  });

  test("signers download it with their own link once sealed, not before", async () => {
    const pending = await sentEnvelope();
    const get = (token: string) => signedPdfRoute.GET(new NextRequest(`https://app.docurama.test/api/sign/${token}/signed-pdf`), { params: Promise.resolve({ token }) });
    expect((await get(pending.tokens[0])).status).toBe(409);

    const { env, tokens } = await sealedEnvelope();
    const res = await get(tokens[1]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(sha(bytes)).toBe((await db.envelope.findUniqueOrThrow({ where: { id: env.id } })).signedPdfSha256!);
    expect(await db.envelopeEvent.count({ where: { envelopeId: env.id, action: "SIGNED_PDF_DOWNLOADED" } })).toBe(1);
    expect((await get("not-a-token")).status).toBe(404);
  });

  test("the evidence pack ships it and verification reports its fingerprint", async () => {
    const { env, code } = await sealedEnvelope();
    const e = await db.envelope.findUniqueOrThrow({ where: { id: env.id } });
    const zip = (await buildEvidencePack(code, tenant.id)).bytes;
    expect(zip.includes((await sealedPdfBytes(env.id))!.bytes.subarray(0, 4096))).toBe(true);
    expect(zip.toString("latin1")).toContain(`"path": "document/${code}-signed.pdf"`);
    const v = await verifyEnvelopeCode(code);
    expect(v.result).toBe("VERIFIED");
    if (v.result === "VERIFIED") expect(v.envelope.signedPdf).toMatchObject({ sha256: e.signedPdfSha256, level: "PAdES-B-B" });
  });
});

/* ── Adopted signatures ────────────────────────────────────────────────────── */

describe("adopted signatures", () => {
  test("a drawn signature is stored, bound into the seal by its hash, and stamped into the PDF", async () => {
    const image = drawnSignature();
    const { env, code } = await sealedEnvelope({ signature: { method: "draw", image } });
    const r = await db.recipient.findFirstOrThrow({ where: { envelopeId: env.id, order: 1 } });
    const bytes = Buffer.from(image.split(",")[1], "base64");
    expect(r).toMatchObject({ signatureMethod: "draw", signatureImage: image, signatureSha256: sha(bytes) });
    const manifest = JSON.parse((await db.envelope.findUniqueOrThrow({ where: { id: env.id } })).sealManifest!);
    expect(manifest.recipients[0].signature).toEqual({ method: "draw", font: null, sha256: sha(bytes) });
    expect(manifest.recipients[1].signature).toMatchObject({ method: "type", font: "caveat" });
    expect((await db.envelopeEvent.findFirstOrThrow({ where: { envelopeId: env.id, action: "SIGNED", actor: SIGNERS[0].name } })).detail).toContain("drawn signature");
    // The PNG is embedded in the sealed PDF.
    const pdf = await PDFDocument.load((await sealedPdfBytes(env.id))!.bytes);
    expect(pdf.context.enumerateIndirectObjects().some(([, o]) => String(o.toString()).includes("/Subtype /Image"))).toBe(true);

    // Swapping the image but keeping its sealed hash is caught.
    await db.recipient.update({ where: { id: r.id }, data: { signatureImage: drawnSignature(7) } });
    try {
      const v = await verifyEnvelopeCode(code);
      expect(v.result).toBe("INTEGRITY_FAILED");
      if (v.result === "INTEGRITY_FAILED") expect(v.envelope.seal.mismatches).toContain("signers");
    } finally {
      await db.recipient.update({ where: { id: r.id }, data: { signatureImage: image } });
    }
    expect((await verifyEnvelopeCode(code)).result).toBe("VERIFIED");
  });

  test("invalid adoptions are refused before anything is recorded", async () => {
    const { tokens, env } = await sentEnvelope();
    const base = { op: "sign", name: SIGNERS[0].name, fieldValues: textValues(SIGNERS[0].email) };
    const jpegPretendingPng = `data:image/png;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64")}`;
    const huge = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), randomBytes(210 * 1024)]).toString("base64")}`;
    expect((await sign(tokens[0], { ...base, signature: { method: "draw" } })).status).toBe(400);
    expect((await sign(tokens[0], { ...base, signature: { method: "upload", image: jpegPretendingPng } })).status).toBe(400);
    expect((await sign(tokens[0], { ...base, signature: { method: "upload", image: huge } })).status).toBe(400);
    expect((await sign(tokens[0], { ...base, signature: { method: "saved" } })).status).toBe(403); // no session
    expect((await db.recipient.findFirstOrThrow({ where: { envelopeId: env.id, order: 1 } })).status).toBe("PENDING");
  });
});

/* ── The workspace seal identity ───────────────────────────────────────────── */

/** A CA-issued seal certificate as a PKCS#12, the way a customer would bring one. */
function caIssuedP12(passphrase: string): Buffer {
  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", P("ca.key"), "-out", P("ca.pem"), "-days", "30",
    "-subj", "/CN=Nordic Trust Test CA/O=Nordic Trust/C=SE", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign");
  openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", P("seal.key"), "-out", P("seal.csr"), "-subj", "/CN=StalFe AB Seal/O=StalFe AB/C=SE");
  writeFileSync(P("seal.ext"), "keyUsage=critical,digitalSignature,nonRepudiation\n");
  openssl("x509", "-req", "-in", P("seal.csr"), "-CA", P("ca.pem"), "-CAkey", P("ca.key"), "-CAcreateserial", "-out", P("seal.pem"), "-days", "30", "-extfile", P("seal.ext"));
  openssl("pkcs12", "-export", "-inkey", P("seal.key"), "-in", P("seal.pem"), "-certfile", P("ca.pem"), "-passout", `pass:${passphrase}`, "-out", P("seal.p12"));
  return readFileSync(P("seal.p12"));
}

describe("seal identity: automatic, with bring-your-own certificates", () => {
  test("an imported CA-issued certificate becomes the seal identity at once and signs the next PDFs", async () => {
    const p12 = caIssuedP12("correct horse battery");
    expect((await settingsOp("cert.import", { pkcs12Base64: p12.toString("base64"), passphrase: "wrong" })).status).toBe(400);

    const kek = process.env.DOCURAMA_KEY_ENCRYPTION_KEY;
    delete process.env.DOCURAMA_KEY_ENCRYPTION_KEY;
    try {
      const refused = await settingsOp("cert.import", { pkcs12Base64: p12.toString("base64"), passphrase: "correct horse battery" });
      expect(refused.status).toBe(409);
      expect(String(refused.json.error)).toContain("DOCURAMA_KEY_ENCRYPTION_KEY");
    } finally {
      process.env.DOCURAMA_KEY_ENCRYPTION_KEY = kek;
    }

    const imported = await settingsOp("cert.import", { pkcs12Base64: p12.toString("base64"), passphrase: "correct horse battery", commonName: "StålFe AB seal 2026" });
    expect(imported.status).toBe(200);
    expect(String(imported.json.message)).toContain("active");
    const row = await db.signingCertificate.findFirstOrThrow({ where: { tenantId: tenant.id, origin: "imported" } });
    expect(row).toMatchObject({ status: "ACTIVE", purpose: "sealing", pkcs12Base64: null });
    expect(row.privateKeyEnc!.startsWith("gcm1:")).toBe(true);
    expect(row.issuer).toContain("Nordic Trust Test CA");
    expect((await settingsOp("cert.import", { pkcs12Base64: p12.toString("base64"), passphrase: "correct horse battery" })).status).toBe(409);

    const identity = await getSealIdentity(tenant.id);
    expect(identity).toMatchObject({ source: "certificate", label: "StålFe AB seal 2026", selfSigned: false });
    expect(identity.chainPems).toHaveLength(1);

    const { env } = await sealedEnvelope();
    const pdf = (await sealedPdfBytes(env.id))!.bytes;
    const report = inspectPdfSignature(pdf);
    expect(report.valid).toBe(true);
    expect(report.signer?.subject).toContain("CN=StalFe AB Seal");
    expect(report.signer?.issuer).toContain("CN=Nordic Trust Test CA");
    expect(opensslVerifiesPdf(pdf)).toBe(true);
    // The chain is embedded: OpenSSL validates the signer up to the CA.
    const text = pdf.toString("latin1");
    const [a, b, c, d] = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)/.exec(text)!.slice(1).map(Number);
    writeFileSync(P("chain.content"), Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]));
    const der = Buffer.from(text.slice(b + 1, c - 1), "hex");
    writeFileSync(P("chain.p7s"), der.subarray(0, der.readUIntBE(2, der[1] & 0x7f) + 2 + (der[1] & 0x7f)));
    expect(openssl("cms", "-verify", "-inform", "DER", "-in", P("chain.p7s"), "-content", P("chain.content"), "-binary",
      "-CAfile", P("ca.pem"), "-purpose", "any", "-out", P("chain.out"))).toBeDefined();
    expect((await db.envelope.findUniqueOrThrow({ where: { id: env.id } })).signedPdfSigner).toContain("issued by");

    // Revoking it hands sealing back to the evidence key, with its key destroyed.
    expect((await settingsOp("cert.revoke", {}, row.id)).status).toBe(200);
    expect((await db.signingCertificate.findUniqueOrThrow({ where: { id: row.id } })).privateKeyEnc).toBeNull();
    expect((await getSealIdentity(tenant.id)).source).toBe("evidence-key");
  });
});

/* ── Template envelopes ────────────────────────────────────────────────────── */

describe("template envelopes get a sealed PDF of the text as sent", () => {
  const TEXT = "# ACCORD DE CONFIDENTIALITÉ\n\n**ENTRE** StålFe AB et Nordlicht GmbH.\n\n### ARTICLE 1 – OBJET\n\nLes Parties s'engagent à :\n1. garder le secret ;\n2. ne rien divulguer.\n\n---\n\nFait à Paris.";

  async function templateEnvelope(contractText: string | null) {
    const token = randomBytes(24).toString("base64url");
    const code = `DOC-TPL${String(++seq).padStart(4, "0")}`;
    const env = await db.envelope.create({
      data: {
        publicCode: code, title: "Accord de confidentialité", titleLower: "accord", tenantId: tenant.id, createdById: owner.id,
        status: "SENT", pages: 1, contractText,
        recipients: { create: [{ name: "Camille Laurent", email: "camille.laurent@stalfe.example", role: "SIGNER", order: 1, accessToken: token }] },
        events: { create: [{ actor: "Alexandra Fischer", action: "SENT", detail: "Sent to 1 signer" }] },
      },
    });
    const done = await sign(token, { op: "sign", name: "Camille Laurent", signature: { method: "draw", image: drawnSignature(3) } });
    expect(done.json.sealed).toBe(true);
    return { env, code, token };
  }

  test("typeset, stamped with the drawn signature, signed, and the text bound into the seal", async () => {
    const { env, code, token } = await templateEnvelope(TEXT);
    const e = await db.envelope.findUniqueOrThrow({ where: { id: env.id } });
    expect(e.signedPdfLevel).toBe("PAdES-B-B");
    const pdf = (await sealedPdfBytes(env.id))!.bytes;
    expect(inspectPdfSignature(pdf)).toMatchObject({ valid: true, coversWholeFile: true });
    expect(opensslVerifiesPdf(pdf)).toBe(true);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(2); // the contract with its signatures, then the certificate page
    expect(doc.getTitle()).toBe("Accord de confidentialité");
    expect(doc.context.enumerateIndirectObjects().some(([, o]) => String(o.toString()).includes("/Subtype /Image"))).toBe(true);

    const manifest = JSON.parse(e.sealManifest!);
    expect(manifest.document).toEqual({ sha256: null, textSha256: sha(TEXT) });
    const v = await verifyEnvelopeCode(code);
    expect(v.result).toBe("VERIFIED");
    if (v.result === "VERIFIED") expect(v.envelope.seal.scope).toContain("document");

    // Downloadable with the signing link, like an upload.
    const res = await signedPdfRoute.GET(new NextRequest(`https://app.docurama.test/api/sign/${token}/signed-pdf`), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(200);

    // The evidence pack exports the text as sent.
    const zip = (await buildEvidencePack(code, tenant.id)).bytes;
    expect(zip.includes(Buffer.from(TEXT, "utf8"))).toBe(true);
  });

  test("changing the snapshot after sealing is reported on the document", async () => {
    const { env, code } = await templateEnvelope(TEXT);
    await db.envelope.update({ where: { id: env.id }, data: { contractText: TEXT.replace("garder le secret", "tout publier") } });
    try {
      const v = await verifyEnvelopeCode(code);
      expect(v.result).toBe("INTEGRITY_FAILED");
      if (v.result === "INTEGRITY_FAILED") expect(v.envelope.seal.mismatches).toContain("document");
    } finally {
      await db.envelope.update({ where: { id: env.id }, data: { contractText: TEXT } });
    }
    expect((await verifyEnvelopeCode(code)).result).toBe("VERIFIED");
  });

  test("an envelope sent before snapshots existed gets no PDF (its template may have changed)", async () => {
    const { env, token } = await templateEnvelope(null);
    expect((await db.envelope.findUniqueOrThrow({ where: { id: env.id } })).signedPdfKey).toBeNull();
    const res = await signedPdfRoute.GET(new NextRequest(`https://app.docurama.test/api/sign/${token}/signed-pdf`), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(404);
  });
});
