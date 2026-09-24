/// <reference types="bun-types" />

/**
 * Fields a signer fills in (src/lib/field-kinds.ts): text, number, dropdown,
 * radio and checkbox. The same rules run on the signing page and in the
 * signing API; values are recorded on the envelope, in the SIGNED event and
 * the seal, and printed on the sealed PDF.
 *
 * Hermetic: scratch SQLite schema, in-process signing route, local storage.
 *
 * Run: bun test e2e/fields.test.ts
 */

import { afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { inflateSync } from "node:zlib";
import { Database } from "bun:sqlite";
import { NextRequest } from "next/server";

const DIR = mkdtempSync(join(tmpdir(), "fields-e2e-"));
process.env.DATABASE_URL = `file:${join(DIR, "scratch.db").replace(/\\/g, "/")}`;
process.env.STORAGE_DIR = join(DIR, "storage").replace(/\\/g, "/");
for (const k of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT", "SMTP_URL", "EVIDENCE_PORTAL_URL"]) delete process.env[k];
process.env.REKOR_WITNESS = "off";
process.env.SEAL_TIMESTAMPS = "off";
new Database(join(DIR, "scratch.db"), { create: true }).close();
execFileSync("node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });

const db = new PrismaClient();
const signRoute = await import("../src/app/api/sign/[token]/route");
const { checkFieldEntry, fieldLabel, fieldOptions, stampText } = await import("../src/lib/field-kinds");
const { storeUpload } = await import("../src/lib/document-store");
const { sealedPdfBytes } = await import("../src/lib/signed-pdf");
const { verifyEnvelopeCode } = await import("../src/lib/verify");

afterAll(async () => {
  await db.$disconnect();
  await (await import("../src/lib/db")).db.$disconnect();
});

const stamp = Date.now();
const tenant = await db.tenant.create({ data: { name: "StålFe AB", slug: `stalfe-fields-${stamp}`, planCode: "BUSINESS", status: "ACTIVE" } });
const sender = await db.user.create({
  data: { email: `alexandra.${stamp}@stalfe.example`, passwordHash: "fixture-not-a-credential", firstName: "Alexandra", lastName: "Fischer", role: "WORKSPACE_ADMIN", status: "ACTIVE" },
});
let seq = 0;

/** The fields a supply agreement asks of its signer, as the builder places them. */
function orderFields(email: string, extra: Record<string, unknown>[] = []) {
  const base = { pageNumber: 1, width: 20, height: 4, recipientEmail: email, recipientName: "Camille Laurent", recipientIndex: 0 };
  return [
    { ...base, id: "f-sig", type: "signature", x: 10, y: 80, label: "Signature" },
    { ...base, id: "f-qty", type: "number", x: 10, y: 20, label: "Tonnes ordered", required: true },
    { ...base, id: "f-grade", type: "select", x: 40, y: 20, label: "Steel grade", options: ["S235", "S275", "S355"], required: true },
    { ...base, id: "f-delivery", type: "radio", x: 10, y: 30, label: "Delivery", options: ["Lyon", "Göteborg"], required: true },
    { ...base, id: "f-po", type: "text", x: 40, y: 30, label: "PO reference", required: false },
    { ...base, id: "f-terms", type: "checkbox", x: 10, y: 40, width: 4, height: 3, label: "I accept the general terms", mustTick: true },
    { ...base, id: "f-news", type: "checkbox", x: 10, y: 45, width: 4, height: 3, label: "Send me product news" },
    ...extra,
  ];
}

async function envelope(opts: { withPdf?: boolean; fields?: (email: string) => Record<string, unknown>[] } = {}) {
  const token = randomBytes(24).toString("base64url");
  const email = `camille.${stamp}.${++seq}@client.example`;
  let documentId: string | undefined;
  if (opts.withPdf) {
    const nda = readFileSync("e2e/fixtures/mutual-nda-two-party.pdf");
    const stored = await storeUpload((async function* () { yield nda; })(), tenant.id);
    documentId = (await db.document.create({ data: {
      id: stored.docId, tenantId: tenant.id, uploadedById: sender.id, filename: "order.pdf",
      storageKey: stored.storageKey, byteSize: stored.byteSize, pageCount: 2, sha256: stored.sha256,
    } })).id;
  }
  const e = await db.envelope.create({ data: {
    publicCode: `DOC-FD${String(seq).padStart(4, "0")}${stamp % 1000}`, title: "Commande acier", titleLower: "commande acier",
    tenantId: tenant.id, createdById: sender.id, status: "SENT", pages: 1, documentId,
    contractText: documentId ? null : "# Commande\n\nLivraison selon les options choisies.",
    fields: JSON.stringify((opts.fields ?? orderFields)(email)),
    recipients: { create: [{ name: "Camille Laurent", email, role: "SIGNER", order: 1, accessToken: token }] },
  } });
  return { id: e.id, code: e.publicCode, token };
}

async function sign(token: string, fieldValues: Record<string, unknown>) {
  const res = await signRoute.POST(new NextRequest(`https://app.docurama.test/api/sign/${token}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ op: "sign", name: "Camille Laurent", fieldValues }),
  }), { params: Promise.resolve({ token }) });
  return { status: res.status, body: await res.json() as { error?: string } };
}

const complete = { "f-qty": "40,5", "f-grade": "S355", "f-delivery": "Göteborg", "f-po": "", "f-terms": true, "f-news": false };

/** How pdf-lib writes a string drawn with a standard font: a hex string. */
const drawnHex = (text: string) => `<${Buffer.from(text, "latin1").toString("hex").toUpperCase()}>`;

/** Every text drawn in the PDF's content streams (Flate streams inflated). */
function pdfText(pdf: Buffer): string {
  const text = pdf.toString("latin1");
  let out = text;
  for (const m of text.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const end = text.indexOf("endstream", start);
    try { out += inflateSync(pdf.subarray(start, end)).toString("latin1"); } catch { /* not Flate */ }
  }
  return out;
}

describe("the rules", () => {
  test("numbers, choices, optional fields and checkboxes", () => {
    expect(checkFieldEntry({ type: "number", label: "Tonnes" }, "1250")).toEqual({ ok: true, value: "1250" });
    expect(checkFieldEntry({ type: "number", label: "Tonnes" }, "12,5")).toEqual({ ok: true, value: "12,5" });
    expect(checkFieldEntry({ type: "number", label: "Tonnes" }, "twelve")).toMatchObject({ ok: false, error: expect.stringContaining("must be a number") });
    expect(checkFieldEntry({ type: "select", label: "Grade", options: ["S235", "S355"] }, "S275")).toMatchObject({ ok: false });
    expect(checkFieldEntry({ type: "radio", label: "Delivery", options: ["Lyon"] }, "")).toMatchObject({ ok: false, error: expect.stringContaining("Please choose") });
    expect(checkFieldEntry({ type: "text", label: "PO", required: false }, "  ")).toEqual({ ok: true, value: "" });
    expect(checkFieldEntry({ type: "checkbox", label: "Terms", mustTick: true }, false)).toMatchObject({ ok: false, error: expect.stringContaining("Please tick") });
    expect(checkFieldEntry({ type: "checkbox", label: "News" }, false)).toEqual({ ok: true, value: "No" });
    expect(checkFieldEntry({ type: "checkbox", label: "News" }, true)).toEqual({ ok: true, value: "Yes" });
    // Builder defaults are not labels a signer understands.
    expect(fieldLabel({ type: "select", label: "Dropdown" })).toBe("Choice");
    expect(fieldLabel({ type: "text", label: "Text Field" })).toBe("Text");
    expect(fieldOptions({ type: "select", options: [" A ", "A", "", 7, "B"] })).toEqual(["A", "B"]);
    expect(stampText({ type: "checkbox", value: "Yes" })).toBe("X");
    expect(stampText({ type: "checkbox", value: "No" })).toBeNull();
  });
});

describe("signing with fields", () => {
  test("each rule is enforced by the signing API, whatever the page sent", async () => {
    const { token } = await envelope();
    const cases: [Record<string, unknown>, string][] = [
      [{ ...complete, "f-qty": "40 tonnes" }, "must be a number"],
      [{ ...complete, "f-grade": "S999" }, "Choose one of the options"],
      [{ ...complete, "f-delivery": "" }, "Please choose \"Delivery\""],
      [{ ...complete, "f-terms": false }, "Please tick \"I accept the general terms\""],
    ];
    for (const [values, error] of cases) {
      const res = await sign(token, values);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(error);
    }
  });

  test("values are recorded on the envelope, in the audit trail and under the seal", async () => {
    const { id, code, token } = await envelope();
    const res = await sign(token, complete);
    expect(res.status).toBe(200);
    const env = await db.envelope.findUniqueOrThrow({ where: { id } });
    expect(env.status).toBe("COMPLETED");
    const values = Object.fromEntries((JSON.parse(env.fields!) as { id: string; value?: string }[]).map((f) => [f.id, f.value]));
    expect(values).toMatchObject({ "f-qty": "40,5", "f-grade": "S355", "f-delivery": "Göteborg", "f-po": "", "f-terms": "Yes", "f-news": "No" });
    const signed = await db.envelopeEvent.findFirstOrThrow({ where: { envelopeId: id, action: "SIGNED" } });
    expect(signed.detail).toContain('Tonnes ordered="40,5"');
    expect(signed.detail).toContain('Steel grade="S355"');
    expect(signed.detail).toContain('I accept the general terms="Yes"');
    const v = await verifyEnvelopeCode(code);
    expect(v.result).toBe("VERIFIED");
  });

  test("the sealed PDF prints the values in their boxes and ticks the checkbox", async () => {
    const { id, token } = await envelope({ withPdf: true });
    expect((await sign(token, complete)).status).toBe(200);
    const pdf = (await sealedPdfBytes(id))!.bytes;
    const text = pdfText(pdf);
    for (const drawn of ["40,5", "S355", "Göteborg", "X"]) expect({ drawn, found: text.includes(drawnHex(drawn)) }).toEqual({ drawn, found: true });
    // An unticked, optional checkbox prints nothing: one X only.
    expect(text.split(`${drawnHex("X")} Tj`).length - 1).toBe(1);
  });

  test("template PDFs list what each signer entered", async () => {
    const { id, token } = await envelope();
    expect((await sign(token, complete)).status).toBe(200);
    const text = pdfText((await sealedPdfBytes(id))!.bytes);
    for (const drawn of ["Steel grade: ", "S355", "Send me product news: ", "No"]) expect({ drawn, found: text.includes(drawnHex(drawn)) }).toEqual({ drawn, found: true });
  });
});
