/// <reference types="bun-types" />

/**
 * Document intelligence — field detection + signer assignment, hermetic.
 *
 * Run: bun test e2e/docintel.test.ts   (no server, no database)
 *
 * Regressions this pins (found testing the builder's AI Auto-Detect by hand):
 *  - every detected field went to signer 1 in a two-party contract;
 *  - "…from the Effective Date." in prose produced a DATE box over body text;
 *  - "Name:" / "Title:" labels were never detected (\b after a colon);
 *  - boxes landed under the label line instead of on the fill-in blank.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractDocument } from "../src/lib/docintel/text-extract";
import { detectFields } from "../src/lib/docintel/field-detector";
import { assignFieldsToSigners } from "../src/lib/docintel/assign-signers";
import type { ExtractResult, PageGeometry } from "../src/lib/docintel/types";

const NDA = new Uint8Array(readFileSync(join(import.meta.dir, "fixtures", "mutual-nda-two-party.pdf")));

function page(lines: [number, string][], pageNumber = 1): PageGeometry {
  // One text item per line, 6pt per character, top-left origin, 12pt tall.
  const items = lines.map(([y, text]) => ({ text, x0: 72, y0: y - 12, x1: 72 + text.length * 6, y1: y }));
  const text = lines.map(([, t]) => t).join("\n");
  return { pageNumber, width: 595, height: 842, hasText: true, charCount: text.length, text, items };
}

const extract = (...pages: PageGeometry[]): ExtractResult => ({
  pageCount: pages.length, pages, hasTextLayer: true, imageOnlyPages: [], text: pages.map((p) => p.text).join("\n"),
});

describe("field detection on a real two-party NDA (text layer)", () => {
  test("finds each party's signature, date, name, title and initials — and nothing in the prose", async () => {
    const fields = await detectFields(await extractDocument(NDA), NDA);
    const on = (pageNumber: number, type: string) => fields.filter((f) => f.pageNumber === pageNumber && f.fieldType === type);

    // Page 1 is clauses only: "Effective Date" and "confidentiality" are prose, not fields.
    expect(fields.filter((f) => f.pageNumber === 1)).toHaveLength(0);
    expect(on(2, "signature")).toHaveLength(2);
    expect(on(2, "date")).toHaveLength(2);
    expect(on(2, "text")).toHaveLength(4); // Name + Title per party
    expect(on(2, "initials")).toHaveLength(2);
    expect(fields.every((f) => f.source === "keyword")).toBe(true);
    // Text holders keep the label they were found with, so the signer is asked for "Name", not "Text".
    expect(on(2, "text").map((f) => f.label).sort()).toEqual(["Name", "Name", "Title", "Title"]);
  });

  test("a field sits on its blank, to the right of the label and on the label's line", async () => {
    const fields = await detectFields(await extractDocument(NDA), NDA);
    const [acmeSignature] = fields.filter((f) => f.fieldType === "signature").sort((a, b) => a.y - b.y);
    // "Signature: ____" starts at x=72pt (12.1%); the blank starts after the label.
    expect(acmeSignature.x).toBeGreaterThan(15);
    // Baseline at 842-650=192pt (22.8%): the box ends on it, it does not start below it.
    expect(acmeSignature.y).toBeLessThan(22.8);
    expect(acmeSignature.y).toBeGreaterThan(17);
  });

  test("two parties: each block — and each initials slot — goes to its own signer", async () => {
    const fields = await detectFields(await extractDocument(NDA), NDA);
    const owners = assignFieldsToSigners(fields, 2);
    const byOwner = (owner: number, type: string) => fields.filter((f, i) => owners[i] === owner && f.fieldType === type);
    for (const owner of [0, 1]) {
      expect(byOwner(owner, "signature")).toHaveLength(1);
      expect(byOwner(owner, "date")).toHaveLength(1);
      expect(byOwner(owner, "text")).toHaveLength(2);
      expect(byOwner(owner, "initials")).toHaveLength(1);
    }
    // Acme's block is above Nordlicht's: signer 1 owns the upper signature.
    const [upper, lower] = fields.map((f, i) => ({ f, owner: owners[i] }))
      .filter(({ f }) => f.fieldType === "signature").sort((a, b) => a.f.y - b.f.y);
    expect([upper.owner, lower.owner]).toEqual([0, 1]);
    // Initials share one line: left to signer 1, right to signer 2.
    const [left, right] = fields.map((f, i) => ({ f, owner: owners[i] }))
      .filter(({ f }) => f.fieldType === "initials").sort((a, b) => a.f.x - b.f.x);
    expect([left.owner, right.owner]).toEqual([0, 1]);
  });
});

describe("label heuristics (synthetic pages)", () => {
  test("prose mentions never become fields; real labels do", async () => {
    const fields = await detectFields(extract(page([
      [100, "The signature of this agreement is binding as of the Effective Date."],
      [120, "Either party may terminate. See the initials rules in Annex 2."],
      [200, "Date: ____ / ____ / ________"],
      [230, "Signature"],
    ])));
    expect(fields.map((f) => f.fieldType).sort()).toEqual(["date", "signature"]);
  });

  test("French blocks: « Fait à Paris, le », « Lu et approuvé », « Nom : », « Paraphes »", async () => {
    const fields = await detectFields(extract(page([
      [150, "Fait à Paris, le ______________"],
      [200, "Le Client"],
      [230, "Lu et approuvé"],
      [300, "Nom : ______________"],
      [330, "Fonction : ______________"],
      [400, "Paraphes : ______"],
    ])));
    expect(fields.map((f) => f.fieldType).sort()).toEqual(["date", "initials", "signature", "text", "text"]);
  });

  test("a document without any label still offers a fallback signature block", async () => {
    const fields = await detectFields(extract(page([[100, "Plain memo with no signature block at all"]])));
    expect(fields.map((f) => [f.fieldType, f.source])).toEqual([["date", "fallback"], ["signature", "fallback"]]);
  });
});

describe("signer assignment", () => {
  test("a single signer owns everything", () => {
    expect(assignFieldsToSigners([
      { fieldType: "signature", pageNumber: 1, x: 10, y: 80 },
      { fieldType: "date", pageNumber: 1, x: 10, y: 85 },
    ], 1)).toEqual([0, 0]);
  });

  test("two-column signature blocks split by column", () => {
    const owners = assignFieldsToSigners([
      { fieldType: "signature", pageNumber: 3, x: 10, y: 70 },
      { fieldType: "signature", pageNumber: 3, x: 55, y: 70 },
      { fieldType: "date", pageNumber: 3, x: 55, y: 78 },
      { fieldType: "date", pageNumber: 3, x: 10, y: 78 },
      { fieldType: "text", pageNumber: 3, x: 57, y: 74 },
    ], 2);
    expect(owners).toEqual([0, 1, 1, 0, 1]);
  });

  test("a date line above the first block joins that block; fields on block-less pages join the last block before them", () => {
    const owners = assignFieldsToSigners([
      { fieldType: "date", pageNumber: 2, x: 10, y: 40 },
      { fieldType: "signature", pageNumber: 2, x: 10, y: 50 },
      { fieldType: "signature", pageNumber: 2, x: 10, y: 70 },
      { fieldType: "text", pageNumber: 3, x: 10, y: 20 },
    ], 2);
    expect(owners).toEqual([0, 0, 1, 1]);
  });

  test("more blocks than signers wrap around instead of leaving signers without a signature", () => {
    const owners = assignFieldsToSigners([1, 2, 3].map((n) => ({ fieldType: "signature", pageNumber: 1, x: 10, y: n * 20 })), 2);
    expect(owners).toEqual([0, 1, 0]);
  });
});
