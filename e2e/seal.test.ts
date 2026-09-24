/// <reference types="bun-types" />

/**
 * Seal v2 (src/lib/seal.ts): signer data, the audit trail and field values
 * are bound into the seal, and verification recomputes it from the records.
 *
 * Hermetic: a scratch SQLite schema, the real signing route called in
 * process, no dev server. Each tampering test edits one database row the way
 * an attacker with database access would, asserts every verify surface
 * reports INTEGRITY_FAILED for exactly that part, then restores the row.
 *
 * Run: bun test e2e/seal.test.ts   (run.sh runs it with the hermetic suites)
 */

import { afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { Database } from "bun:sqlite";
import { NextRequest } from "next/server";

const SCRATCH = join(mkdtempSync(join(tmpdir(), "seal-e2e-")), "scratch.db");
process.env.DATABASE_URL = `file:${SCRATCH.replace(/\\/g, "/")}`;
process.env.REKOR_WITNESS = "off";
process.env.SEAL_TIMESTAMPS = "off"; // RFC 3161 has its own suite (e2e/timestamp.test.ts)
delete process.env.EVIDENCE_PORTAL_URL;
new Database(SCRATCH, { create: true }).close();
execFileSync("node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });

const db = new PrismaClient();

/* ── System under test (imported after DATABASE_URL is in place) ───────────── */
const seal = await import("../src/lib/seal");
const { verifyEnvelopeCode } = await import("../src/lib/verify");
const { computeLegacyEnvelopeDigest } = await import("../src/lib/esign");
const { buildEvidencePack, EvidencePackError } = await import("../src/lib/evidence-pack");
const signRoute = await import("../src/app/api/sign/[token]/route");
const v1Route = await import("../src/app/api/v1/[...path]/route");

afterAll(async () => {
  await db.$disconnect();
  await (await import("../src/lib/db")).db.$disconnect();
});

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

const tenant = await db.tenant.create({ data: { name: "StålFe AB", slug: `stalfe-seal-${Date.now()}`, planCode: "BUSINESS", status: "ACTIVE" } });
const sender = await db.user.create({
  data: { email: `alex.seal.${Date.now()}@stalfe.example`, passwordHash: "fixture-not-a-credential", firstName: "Alexandra", lastName: "Fischer", role: "WORKSPACE_ADMIN", status: "ACTIVE" },
});

let codeSeq = 0;

/** A SENT envelope: two signers, a CC, and placed fields for both signers. */
async function sentEnvelope(opts: { withDocument: boolean }) {
  const tokens = [randomBytes(24).toString("base64url"), randomBytes(24).toString("base64url")];
  const doc = opts.withDocument
    ? await db.document.create({
        data: {
          id: `doc_${randomBytes(16).toString("hex")}`, tenantId: tenant.id, uploadedById: sender.id,
          filename: "contrat-fourniture.pdf", storageKey: "fixture/never-read.pdf", byteSize: 1024, pageCount: 2,
          sha256: sha(`fixture-pdf-${codeSeq}`),
        },
      })
    : null;
  const fields = [
    { id: "f-sig-1", type: "signature", pageNumber: 2, x: 10, y: 80, width: 30, height: 6, recipientEmail: "camille.laurent@stalfe.example", label: "Signature" },
    { id: "f-title-1", type: "text", pageNumber: 2, x: 10, y: 88, width: 30, height: 4, recipientEmail: "camille.laurent@stalfe.example", label: "Title" },
    { id: "f-sig-2", type: "signature", pageNumber: 2, x: 55, y: 80, width: 30, height: 6, recipientEmail: "jonas.weber@nordlicht.example", label: "Signature" },
    { id: "f-date-2", type: "date", pageNumber: 2, x: 55, y: 88, width: 20, height: 4, recipientEmail: "jonas.weber@nordlicht.example", label: "Date" },
  ];
  const code = `DOC-SEAL${String(++codeSeq).padStart(4, "0")}`;
  const env = await db.envelope.create({
    data: {
      publicCode: code, title: "Contrat de fourniture 2027", titleLower: "contrat de fourniture 2027",
      tenantId: tenant.id, createdById: sender.id, status: "SENT", pages: 2,
      documentId: doc?.id, sha256: doc?.sha256, fields: JSON.stringify(fields),
      recipients: {
        create: [
          { name: "Camille Laurent", email: "camille.laurent@stalfe.example", role: "SIGNER", order: 1, accessToken: tokens[0] },
          { name: "Jonas Weber", email: "jonas.weber@nordlicht.example", role: "SIGNER", order: 2, accessToken: tokens[1] },
          { name: "Hugo Moreau", email: "hugo.moreau@stalfe.example", role: "CC", order: 3, accessToken: randomBytes(24).toString("base64url") },
        ],
      },
      events: { create: [{ actor: "Alexandra Fischer", action: "SENT", detail: "Sent to 2 signers in routing order" }] },
    },
  });
  return { env, doc, tokens, code };
}

async function callSign(token: string, body: Record<string, unknown>) {
  const req = new NextRequest(`https://app.docurama.test/api/sign/${token}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const res = await signRoute.POST(req, { params: Promise.resolve({ token }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Both signers complete, in order; the second signature seals the envelope. */
async function sealedEnvelope(opts: { withDocument: boolean }) {
  const made = await sentEnvelope(opts);
  expect((await callSign(made.tokens[0], { op: "view" })).status).toBe(200);
  const first = await callSign(made.tokens[0], { op: "sign", name: "Camille Laurent", fieldValues: { "f-title-1": "Directrice qualité" } });
  expect(first.status).toBe(200);
  expect(first.json.sealed).toBe(false);
  const second = await callSign(made.tokens[1], { op: "sign", name: "Jonas Weber" });
  expect(second.status).toBe(200);
  expect(second.json.sealed).toBe(true);
  return made;
}

async function verifyV1(code: string) {
  const res = await v1Route.GET(new NextRequest(`https://app.docurama.test/api/v1/verify/${code}`), { params: Promise.resolve({ path: ["verify", code] }) });
  return (await res.json()) as Awaited<ReturnType<typeof verifyEnvelopeCode>>;
}

/** Apply a tampering edit, assert both surfaces fail on `part`, then restore. */
async function expectTamperDetected(code: string, part: string, tamper: () => Promise<unknown>, restore: () => Promise<unknown>) {
  await tamper();
  try {
    for (const v of [await verifyEnvelopeCode(code), await verifyV1(code)]) {
      expect(v.result).toBe("INTEGRITY_FAILED");
      if (v.result !== "INTEGRITY_FAILED") return;
      expect(v.envelope.seal.mismatches).toContain(part as never);
      expect(v.envelope).not.toHaveProperty("signers");
    }
  } finally {
    await restore();
  }
  expect((await verifyEnvelopeCode(code)).result).toBe("VERIFIED");
}

/* ── Manifest: deterministic and complete ──────────────────────────────────── */

/** Pins the v2 serialization: if this changes, every existing seal breaks. */
const PINNED_VECTOR_DIGEST = "a21d277087b299016cab42ad9d1a47f229d589b7576cba083d3225b1fa6405e4";

describe("seal manifest", () => {
  const base = {
    publicCode: "DOC-VECTOR1", title: "Accord de confidentialité", pages: 3,
    createdAt: new Date("2026-09-01T08:00:00.000Z"), sealedAt: new Date("2026-09-02T10:00:00.000Z"),
    documentSha256: "a".repeat(64), verifiedSenderDomain: "stalfe.example",
    recipients: [
      { order: 2, name: "Jonas Weber", email: "Jonas.Weber@nordlicht.example", role: "SIGNER", authMethod: "EMAIL", status: "SIGNED", signedAt: new Date("2026-09-02T10:00:00.000Z") },
      { order: 1, name: "Camille Laurent", email: "camille.laurent@stalfe.example", role: "SIGNER", authMethod: "SMS", status: "SIGNED", signedAt: new Date("2026-09-01T09:30:00.000Z") },
    ],
    events: [
      { at: new Date("2026-09-02T10:00:00.000Z"), actor: "Jonas Weber", action: "SIGNED", detail: "Signed by Jonas Weber", ipHash: null },
      { at: new Date("2026-09-01T08:00:00.000Z"), actor: "Alexandra Fischer", action: "SENT", detail: "Sent", ipHash: "ab12" },
      { at: new Date("2026-09-02T10:00:00.000Z"), actor: "Docurama", action: "SEALED", detail: "digest inside", ipHash: null },
      { at: new Date("2026-09-03T10:00:00.000Z"), actor: "Alexandra Fischer", action: "DOCUMENT_VIEWED", detail: "after sealing", ipHash: null },
    ],
    fields: JSON.stringify([
      { id: "b", type: "text", pageNumber: 1, x: 1.5, y: 2, width: 3, height: 4, recipientEmail: "Camille.Laurent@stalfe.example", label: "Title", value: "Directrice qualité" },
      { id: "a", type: "signature", pageNumber: 1, x: 5, y: 6, width: 7, height: 8, recipientEmail: "jonas.weber@nordlicht.example", label: "Signature", value: "Jonas Weber" },
    ]),
  };

  test("covers names, event details and field values; excludes SEALED and post-seal events", () => {
    const m = seal.buildSealManifest(base);
    expect(m.format).toBe("docurama-seal/2");
    expect(m.recipients.map((r) => r.name)).toEqual(["Camille Laurent", "Jonas Weber"]);
    expect(m.recipients[1].email).toBe("jonas.weber@nordlicht.example");
    expect(m.events.map((e) => e.action)).toEqual(["SENT", "SIGNED"]);
    expect(m.events[0].detail).toBe("Sent");
    expect(m.fields.map((f) => [f.id, f.value])).toEqual([["a", "Jonas Weber"], ["b", "Directrice qualité"]]);
    expect(m.document.sha256).toBe("a".repeat(64));
  });

  test("the digest does not depend on input order", () => {
    const shuffled = {
      ...base,
      recipients: [...base.recipients].reverse(),
      events: [...base.events].reverse(),
      fields: JSON.stringify([...JSON.parse(base.fields)].reverse()),
    };
    expect(seal.sealDigest(seal.buildSealManifest(shuffled))).toBe(seal.sealDigest(seal.buildSealManifest(base)));
  });

  test("the digest is the SHA-256 of the canonical manifest bytes (pinned format)", () => {
    const m = seal.buildSealManifest(base);
    expect(seal.sealDigest(m)).toBe(sha(seal.sealManifestJson(m)));
    expect(seal.sealManifestJson(m).startsWith('{"document":{"sha256":"aaaa')).toBe(true);
    expect(seal.sealDigest(m)).toBe(PINNED_VECTOR_DIGEST);
  });

  test("changing any bound value changes the digest", () => {
    const digest = seal.sealDigest(seal.buildSealManifest(base));
    const variants = [
      { ...base, recipients: [{ ...base.recipients[0], name: "Jonas Webber" }, base.recipients[1]] },
      { ...base, recipients: [base.recipients[0], { ...base.recipients[1], signedAt: new Date("2026-09-01T09:31:00.000Z") }] },
      { ...base, recipients: [base.recipients[0], { ...base.recipients[1], authMethod: "EMAIL" }] },
      { ...base, events: [{ ...base.events[0], detail: "Signed by someone else" }, ...base.events.slice(1)] },
      { ...base, fields: base.fields.replace("Directrice qualité", "Stagiaire") },
      { ...base, documentSha256: "b".repeat(64) },
      { ...base, title: "Accord de confidentialité (v2)" },
    ];
    for (const v of variants) expect(seal.sealDigest(seal.buildSealManifest(v))).not.toBe(digest);
    // A post-seal event is not part of the seal.
    const later = { ...base, events: [...base.events, { at: new Date("2026-09-04T00:00:00.000Z"), actor: "x", action: "REMINDED", detail: null, ipHash: null }] };
    expect(seal.sealDigest(seal.buildSealManifest(later))).toBe(digest);
  });
});


/* ── Sealing through the real signing route ────────────────────────────────── */

describe("sealing binds signer data", () => {
  test("the last signature seals with the v2 manifest, including the CC and the entered values", async () => {
    const { code, doc } = await sealedEnvelope({ withDocument: true });
    const env = await db.envelope.findUniqueOrThrow({ where: { publicCode: code } });
    expect(env.status).toBe("COMPLETED");
    expect(env.sealFormat).toBe("docurama-seal/2");
    expect(env.sha256).toBe(sha(env.sealManifest!));
    expect(env.sha256).not.toBe(doc!.sha256);
    const m = JSON.parse(env.sealManifest!) as import("../src/lib/seal").SealManifest;
    expect(m.document.sha256).toBe(doc!.sha256);
    expect(m.recipients.map((r) => `${r.order}:${r.name}:${r.role}:${r.status}`)).toEqual([
      "1:Camille Laurent:SIGNER:SIGNED", "2:Jonas Weber:SIGNER:SIGNED", "3:Hugo Moreau:CC:PENDING",
    ]);
    expect(Object.fromEntries(m.fields.map((f) => [f.id, f.value]))).toEqual({
      "f-date-2": env.sealedAt!.toISOString().slice(0, 10),
      "f-sig-1": "Camille Laurent",
      "f-sig-2": "Jonas Weber",
      "f-title-1": "Directrice qualité",
    });
    expect(m.events.map((e) => e.action)).toEqual(["SENT", "VIEWED", "SIGNED", "SIGNED"]);
    expect(m.events.some((e) => e.detail?.includes('Title="Directrice qualité"'))).toBe(true);
    const sealedEvent = await db.envelopeEvent.findFirstOrThrow({ where: { envelopeId: env.id, action: "SEALED" } });
    expect(sealedEvent.detail).toContain("docurama-seal/2");
    expect(sealedEvent.detail).toContain("3 recipient(s), 4 event(s) and 4 field value(s)");
  });

  test("verification recomputes the seal: VERIFIED, all four parts bound, committed to the log", async () => {
    const { code, doc } = await sealedEnvelope({ withDocument: true });
    for (const v of [await verifyEnvelopeCode(code), await verifyV1(code)]) {
      expect(v.result).toBe("VERIFIED");
      if (v.result !== "VERIFIED") return;
      expect(v.envelope.seal).toMatchObject({
        format: "docurama-seal/2", integrity: "INTACT",
        scope: ["document", "signers", "audit-trail", "field-values"],
        documentSha256: doc!.sha256, bound: { signers: 2, events: 4, fields: 4 }, mismatches: [],
      });
      expect(v.envelope.seal.transparency.status).toBe("MATCHES");
      expect(v.envelope.signers.map((s) => s.name)).toEqual(["Camille Laurent", "Jonas Weber"]);
    }
  });

  test("a template envelope (no file) binds signers, trail and values", async () => {
    const { code } = await sealedEnvelope({ withDocument: false });
    const v = await verifyEnvelopeCode(code);
    expect(v.result).toBe("VERIFIED");
    if (v.result === "VERIFIED") {
      expect(v.envelope.seal.scope).toEqual(["signers", "audit-trail", "field-values"]);
      expect(v.envelope.seal.documentSha256).toBeNull();
    }
  });
});

/* ── Tampering after sealing ───────────────────────────────────────────────── */

describe("tampering after sealing is reported, never verified", () => {
  test("a renamed signer", async () => {
    const { env, code } = await sealedEnvelope({ withDocument: true });
    const r = await db.recipient.findFirstOrThrow({ where: { envelopeId: env.id, order: 1 } });
    await expectTamperDetected(code, "signers",
      () => db.recipient.update({ where: { id: r.id }, data: { name: "Someone Else" } }),
      () => db.recipient.update({ where: { id: r.id }, data: { name: r.name } }));
  });

  test("a moved signing time", async () => {
    const { env, code } = await sealedEnvelope({ withDocument: true });
    const r = await db.recipient.findFirstOrThrow({ where: { envelopeId: env.id, order: 2 } });
    await expectTamperDetected(code, "signers",
      () => db.recipient.update({ where: { id: r.id }, data: { signedAt: new Date(r.signedAt!.getTime() - 86_400_000) } }),
      () => db.recipient.update({ where: { id: r.id }, data: { signedAt: r.signedAt } }));
  });

  test("an edited audit event", async () => {
    const { env, code } = await sealedEnvelope({ withDocument: true });
    const ev = await db.envelopeEvent.findFirstOrThrow({ where: { envelopeId: env.id, action: "VIEWED" } });
    await expectTamperDetected(code, "audit-trail",
      () => db.envelopeEvent.update({ where: { id: ev.id }, data: { detail: "Signing link opened from another country" } }),
      () => db.envelopeEvent.update({ where: { id: ev.id }, data: { detail: ev.detail } }));
  });

  test("a backdated event inserted before the seal", async () => {
    const { env, code } = await sealedEnvelope({ withDocument: true });
    let inserted = "";
    await expectTamperDetected(code, "audit-trail",
      async () => { inserted = (await db.envelopeEvent.create({ data: { envelopeId: env.id, actor: "Camille Laurent", action: "DECLINED", at: env.createdAt } })).id; },
      () => db.envelopeEvent.delete({ where: { id: inserted } }));
  });

  test("a changed field value", async () => {
    const { env, code } = await sealedEnvelope({ withDocument: true });
    const fresh = await db.envelope.findUniqueOrThrow({ where: { id: env.id } });
    await expectTamperDetected(code, "field-values",
      () => db.envelope.update({ where: { id: env.id }, data: { fields: fresh.fields!.replace("Directrice qualité", "Stagiaire") } }),
      () => db.envelope.update({ where: { id: env.id }, data: { fields: fresh.fields } }));
  });

  test("a swapped document fingerprint", async () => {
    const { code, doc } = await sealedEnvelope({ withDocument: true });
    await expectTamperDetected(code, "document",
      () => db.document.update({ where: { id: doc!.id }, data: { sha256: "f".repeat(64) } }),
      () => db.document.update({ where: { id: doc!.id }, data: { sha256: doc!.sha256 } }));
  });

  test("a consistent forgery (records, manifest and digest all rewritten) is caught by the transparency log", async () => {
    const { env, code } = await sealedEnvelope({ withDocument: true });
    const before = await db.envelope.findUniqueOrThrow({ where: { id: env.id }, include: seal.sealCheckInclude });
    const r = before.recipients.find((x) => x.order === 1)!;
    const forged = seal.buildSealManifest({
      publicCode: before.publicCode, title: before.title, pages: before.pages, createdAt: before.createdAt, sealedAt: before.sealedAt!,
      documentSha256: before.document!.sha256, verifiedSenderDomain: before.verifiedSenderDomain,
      recipients: before.recipients.map((x) => (x.id === r.id ? { ...x, name: "Someone Else" } : x)),
      events: before.events, fields: before.fields,
    });
    await expectTamperDetected(code, "transparency-log",
      async () => {
        await db.recipient.update({ where: { id: r.id }, data: { name: "Someone Else" } });
        await db.envelope.update({ where: { id: env.id }, data: { sha256: seal.sealDigest(forged), sealManifest: seal.sealManifestJson(forged) } });
      },
      async () => {
        await db.recipient.update({ where: { id: r.id }, data: { name: r.name } });
        await db.envelope.update({ where: { id: env.id }, data: { sha256: before.sha256, sealManifest: before.sealManifest } });
      });
  });

  test("a downgrade to the legacy rules (format cleared, digest set to the file hash)", async () => {
    const { env, code, doc } = await sealedEnvelope({ withDocument: true });
    const before = await db.envelope.findUniqueOrThrow({ where: { id: env.id } });
    await expectTamperDetected(code, "seal-record",
      () => db.envelope.update({ where: { id: env.id }, data: { sealFormat: null, sha256: doc!.sha256 } }),
      () => db.envelope.update({ where: { id: env.id }, data: { sealFormat: before.sealFormat, sha256: before.sha256 } }));
  });

  test("events recorded after sealing do not affect the seal", async () => {
    const { env, code } = await sealedEnvelope({ withDocument: true });
    await db.envelopeEvent.create({ data: { envelopeId: env.id, actor: "Alexandra Fischer", action: "DOCUMENT_VIEWED", detail: "Downloaded the signed copy" } });
    expect((await verifyEnvelopeCode(code)).result).toBe("VERIFIED");
  });

  test("no evidence pack is signed over modified records", async () => {
    const { env } = await sealedEnvelope({ withDocument: false });
    const r = await db.recipient.findFirstOrThrow({ where: { envelopeId: env.id, order: 1 } });
    await db.recipient.update({ where: { id: r.id }, data: { email: "attacker@example.com" } });
    try {
      const err = await buildEvidencePack(env.publicCode, tenant.id).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(EvidencePackError);
      expect((err as InstanceType<typeof EvidencePackError>).status).toBe(409);
      expect(String((err as Error).message)).toContain("signer records");
    } finally {
      await db.recipient.update({ where: { id: r.id }, data: { email: r.email } });
    }
  });

  test("an intact pack ships the seal manifest whose hash is the sealed digest", async () => {
    const { env } = await sealedEnvelope({ withDocument: false });
    const sealed = await db.envelope.findUniqueOrThrow({ where: { id: env.id } });
    const files = readZip((await buildEvidencePack(env.publicCode, tenant.id)).bytes);
    expect(files.get("evidence/seal-manifest.json")?.toString("utf8")).toBe(sealed.sealManifest!);
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as {
      payload: { envelope: { sha256: string }; seal: Record<string, unknown>; artifacts: { path: string; sha256: string }[] };
    };
    expect(manifest.payload.envelope.sha256).toBe(sealed.sha256!);
    expect(manifest.payload.seal).toEqual({
      format: "docurama-seal/2", binds: ["signers", "audit-trail", "field-values"],
      documentSha256: null, manifestPath: "evidence/seal-manifest.json", timestamp: null, signedPdf: null,
    });
    expect(manifest.payload.artifacts.find((a) => a.path === "evidence/seal-manifest.json")?.sha256).toBe(sealed.sha256!);
  });
});

/** Minimal STORE-method ZIP reader (the pack is never compressed). */
function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a ZIP");
  const files = new Map<string, Buffer>();
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    const size = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    files.set(name, Buffer.from(buf.subarray(start, start + size)));
    off += 46 + nameLen + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);
  }
  return files;
}

/* ── Seals made before v2 ──────────────────────────────────────────────────── */

describe("legacy seals are verified by the rules they were made under", () => {
  test("an upload sealed with its file hash: VERIFIED, document only", async () => {
    const { env, doc, code } = await sentEnvelope({ withDocument: true });
    const sealedAt = new Date();
    await db.recipient.updateMany({ where: { envelopeId: env.id, role: "SIGNER" }, data: { status: "SIGNED", signedAt: sealedAt } });
    await db.envelope.update({ where: { id: env.id }, data: { status: "COMPLETED", sealedAt, completedAt: sealedAt, sha256: doc!.sha256 } });
    const v = await verifyEnvelopeCode(code);
    expect(v.result).toBe("VERIFIED");
    if (v.result === "VERIFIED") {
      expect(v.envelope.seal).toMatchObject({ format: "legacy", scope: ["document"], integrity: "INTACT" });
      expect(v.envelope.seal.transparency.status).toBe("NOT_COMMITTED");
    }
    await expectTamperDetected(code, "document",
      () => db.document.update({ where: { id: doc!.id }, data: { sha256: "e".repeat(64) } }),
      () => db.document.update({ where: { id: doc!.id }, data: { sha256: doc!.sha256 } }));
  });

  test("a template envelope sealed with the v1 record digest: VERIFIED, roster and trail", async () => {
    const { env, code } = await sentEnvelope({ withDocument: false });
    const sealedAt = new Date(Date.now() + 1000);
    await db.recipient.updateMany({ where: { envelopeId: env.id, role: "SIGNER" }, data: { status: "SIGNED", signedAt: sealedAt } });
    const full = await db.envelope.findUniqueOrThrow({ where: { id: env.id }, include: { recipients: true, events: true } });
    const v1 = computeLegacyEnvelopeDigest({
      publicCode: full.publicCode, title: full.title, pages: full.pages, createdAt: full.createdAt,
      recipients: full.recipients.filter((r) => r.role === "SIGNER"), events: full.events,
    });
    await db.envelope.update({ where: { id: env.id }, data: { status: "COMPLETED", sealedAt, completedAt: sealedAt, sha256: v1 } });
    const v = await verifyEnvelopeCode(code);
    expect(v.result).toBe("VERIFIED");
    if (v.result === "VERIFIED") expect(v.envelope.seal).toMatchObject({ format: "legacy", scope: ["signers", "audit-trail"] });
  });

  test("a seeded digest that matches nothing is not verified", async () => {
    const { env, code } = await sentEnvelope({ withDocument: false });
    await db.envelope.update({ where: { id: env.id }, data: { status: "COMPLETED", sealedAt: new Date(), sha256: sha("made-up") } });
    const v = await verifyEnvelopeCode(code);
    expect(v.result).toBe("INTEGRITY_FAILED");
  });
});
