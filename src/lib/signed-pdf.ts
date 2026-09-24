/**
 * The sealed PDF: the document everyone signed, as one self-verifying file.
 *
 * Built once, right after sealing (and lazily on first download if that
 * failed): the uploaded PDF with every adopted signature and filled value
 * stamped where the sender placed it, plus a signature-certificate page (who
 * signed when and how, the seal digest, the timestamp and a QR code to the
 * public verification page). The whole file is then signed with PAdES by the
 * workspace seal identity (src/lib/seal-identity.ts), with an RFC 3161
 * signature timestamp from the workspace's TSA (src/lib/tsa.ts).
 *
 * The original upload is untouched and stays the fingerprint the seal binds
 * (src/lib/seal.ts); the sealed PDF is a derived artefact whose own signature
 * protects it, and whose hash is recorded on the envelope and in its ledger.
 *
 * Long-term upkeep (maintainSealedPdfs, run by the background worker): a file
 * that stayed at B-T or B-LT because a proof was unobtainable is retried with
 * backoff for 30 days, and a B-LTA file gets a new archive timestamp a year
 * before its TSA certificate expires. Each update appends to the file, so an
 * earlier copy is a prefix of the current one; its fingerprint is kept in
 * signedPdfRevisions so copies downloaded before still verify.
 */
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { db } from "@/lib/db";
import { readSealedPdf, readStoredBytes, storeSealedPdf } from "@/lib/document-store";
import { addSignaturePlaceholder, signPdf } from "@/lib/pades";
import { getSealIdentity } from "@/lib/seal-identity";
import { assignedTsa } from "@/lib/tsa";
import { extendToLongTerm, maintainLongTerm } from "@/lib/ltv";
import { pemToDer } from "@/lib/der";
import { signedPdfRevisions } from "@/lib/seal-shared";
import { publicVerifyUrl } from "@/lib/app-origin";
import { fieldLabel, isEnteredField, stampText } from "@/lib/field-kinds";
import { createHash } from "crypto";

const INK = rgb(0.06, 0.16, 0.4);
const MUTED = rgb(0.38, 0.42, 0.48);
const TEXT = rgb(0.07, 0.09, 0.13);
const ACCENT = rgb(0.02, 0.47, 0.34);
const RULE = rgb(0.85, 0.88, 0.9);

export { publicVerifyUrl };

const fmtUtc = (d: Date) => `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;

/** Standard PDF fonts only encode WinAnsi: fold accents, replace the rest. */
function safe(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-")) {
    try { font.widthOfTextAtSize(ch, 10); out += ch; continue; } catch { /* not encodable */ }
    const folded = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    try { font.widthOfTextAtSize(folded, 10); out += folded; } catch { out += "?"; }
  }
  return out;
}

function fitSize(font: PDFFont, text: string, maxWidth: number, maxSize: number, minSize = 4): number {
  let size = maxSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Map a field box (percent of the page as displayed, top-left origin) to PDF
 * user space, honouring the page's /Rotate. Returns the display-bottom-left
 * anchor and the rotation to draw upright on screen.
 */
function placeOnPage(page: PDFPage, f: { x: number; y: number; width: number; height: number }) {
  const crop = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const [dw, dh] = rot === 90 || rot === 270 ? [crop.height, crop.width] : [crop.width, crop.height];
  const box = { x: (f.x / 100) * dw, y: (f.y / 100) * dh, width: (f.width / 100) * dw, height: (f.height / 100) * dh };
  const toPdf = (dx: number, dy: number) => {
    if (rot === 90) return { x: crop.x + dy, y: crop.y + dx };
    if (rot === 180) return { x: crop.x + crop.width - dx, y: crop.y + dy };
    if (rot === 270) return { x: crop.x + crop.width - dy, y: crop.y + crop.height - dx };
    return { x: crop.x + dx, y: crop.y + crop.height - dy };
  };
  return { box, toPdf, rotate: degrees(rot) };
}

type Stamp = {
  type: string; pageNumber: number; x: number; y: number; width: number; height: number;
  value: string; image?: PDFImage | null; caption?: string;
};

/**
 * Draw one filled field inside its box (display coordinates, top-left origin).
 * Signatures and initials sit on the line at the bottom of the box, with the
 * envelope caption above them; text values are centred on the blank over a
 * white backing, so a printed underline, slash or dot pattern does not run
 * through them.
 */
function drawStamp(page: PDFPage, s: Stamp, fonts: { script: PDFFont; body: PDFFont }) {
  const { box, toPdf, rotate } = placeOnPage(page, s);
  const pad = Math.min(1.5, box.height * 0.08);
  const signature = s.type === "signature" || s.type === "initials";
  const caption = s.caption ? safe(fonts.body, s.caption) : "";
  const captionSize = caption ? Math.min(4.5, Math.max(3, box.height * 0.14)) : 0;
  // Display rectangle -> PDF: anchor at its display bottom-left, drawn rotated.
  const at = (dx: number, dyFromTop: number) => toPdf(box.x + dx, box.y + dyFromTop);

  if (caption) {
    const p = at(pad, pad + captionSize);
    page.drawText(caption, { x: p.x, y: p.y, size: captionSize, font: fonts.body, color: MUTED, rotate });
  }
  const top = pad + (caption ? captionSize + 1 : 0);
  const room = { width: box.width - pad * 2, height: box.height - top - pad };

  if (s.image) {
    const scale = Math.min(room.width / s.image.width, room.height / s.image.height);
    const w = s.image.width * scale, h = s.image.height * scale;
    const p = at(pad, box.height - pad);
    page.drawImage(s.image, { x: p.x, y: p.y, width: w, height: h, rotate });
    return;
  }
  if (!s.value) return;
  const font = signature ? fonts.script : fonts.body;
  const text = safe(font, s.value);
  if (signature) {
    // Baseline a little above the bottom edge: descenders may cross the line, like ink.
    const size = fitSize(font, text, room.width, Math.min(22, room.height * 0.95));
    const p = at(pad, box.height - pad - size * 0.18);
    page.drawText(text, { x: p.x, y: p.y, size, font, color: INK, rotate });
    return;
  }
  const size = fitSize(font, text, room.width, Math.min(11, room.height * 0.75));
  const width = font.widthOfTextAtSize(text, size);
  const baseline = box.height / 2 + size * 0.35;
  if (s.type === "checkbox") {
    // The tick mark, centred in its box.
    const p = at((box.width - width) / 2, baseline);
    page.drawText(text, { x: p.x, y: p.y, size, font, color: INK, rotate });
    return;
  }
  const back = at(pad - 1, baseline + size * 0.28);
  page.drawRectangle({ x: back.x, y: back.y, width: width + 2, height: size * 1.15, color: rgb(1, 1, 1), rotate });
  const p = at(pad, baseline);
  page.drawText(text, { x: p.x, y: p.y, size, font, color: INK, rotate });
}

export type SealedPdfBase = {
  code: string;
  title: string;
  tenantName: string;
  sealedAt: Date;
  sealDigest: string;
  documentSha256: string;
  manifestTimestamp: { at: Date; tsa: string } | null;
  identity: { label: string; issuer: string; selfSigned: boolean };
  signers: { order: number; name: string; email: string; signedAt: Date | null; method: string | null; font: string | null; image: string | null }[];
  fields: { id: string; type: string; pageNumber: number; x: number; y: number; width: number; height: number; recipientEmail?: string; label?: string; value?: string }[];
  /** How the fingerprint is labelled on the certificate page (set by the composers). */
  documentLabel: string;
};

export type SealedPdfInput = Omit<SealedPdfBase, "documentLabel"> & { original: Buffer };

const METHOD_LABEL: Record<string, string> = {
  draw: "Drawn signature", upload: "Uploaded signature image", saved: "Saved signature", type: "Typed signature",
};

type Kit = {
  pdf: PDFDocument;
  fonts: { script: PDFFont; body: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont; mono: PDFFont };
  imageFor: (dataUrl: string | null) => Promise<PDFImage | null>;
};

async function kitFor(pdf: PDFDocument): Promise<Kit> {
  const [script, body, bold, italic, boldItalic, mono] = await Promise.all([
    pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
    pdf.embedFont(StandardFonts.HelveticaOblique),
    pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    pdf.embedFont(StandardFonts.Courier),
  ]);
  const images = new Map<string, PDFImage>();
  const imageFor = async (dataUrl: string | null): Promise<PDFImage | null> => {
    if (!dataUrl) return null;
    if (images.has(dataUrl)) return images.get(dataUrl)!;
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(dataUrl);
    if (!m) return null;
    const bytes = Buffer.from(m[2], "base64");
    const img = m[1] === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    images.set(dataUrl, img);
    return img;
  };
  return { pdf, fonts: { script, body, bold, italic, boldItalic, mono }, imageFor };
}

/** The signature-certificate page, then the (invisible) signature field on it. */
async function finishSealedPdf(kit: Kit, input: SealedPdfBase): Promise<Uint8Array> {
  const { pdf, fonts: { script, body, bold, mono }, imageFor } = kit;
  const page = pdf.addPage([595.28, 841.89]);
  const M = 48;
  const W = 595.28 - M * 2;
  let y = 841.89 - M;
  const text = (t: string, o: { x?: number; size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    const font = o.font ?? body;
    page.drawText(safe(font, t), { x: o.x ?? M, y, size: o.size ?? 9, font, color: o.color ?? TEXT });
  };
  const rule = () => { page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: RULE }); };

  text("Signature certificate", { size: 18, font: bold });
  text("Docurama", { x: M + W - bold.widthOfTextAtSize("Docurama", 12), size: 12, font: bold, color: ACCENT });
  y -= 16;
  text("This page is part of the sealed document and is covered by its digital signature.", { size: 8.5, color: MUTED });
  y -= 14; rule(); y -= 20;

  for (const line of wrap(bold, safe(bold, input.title), 13, W).slice(0, 3)) { text(line, { size: 13, font: bold }); y -= 17; }
  y -= 2;
  const facts: [string, string][] = [
    ["Organization", input.tenantName],
    ["Verification code", input.code],
    ["Sealed", fmtUtc(input.sealedAt)],
    ["Digitally signed by", `${input.identity.label} (${input.identity.selfSigned ? "self-signed" : `issued by ${input.identity.issuer}`})`],
  ];
  for (const [k, v] of facts) {
    text(k, { size: 8.5, color: MUTED });
    for (const line of wrap(body, safe(body, v), 9.5, W - 130).slice(0, 2)) { text(line, { x: M + 130, size: 9.5 }); y -= 13; }
  }
  y -= 8; rule(); y -= 18;

  text("Signers", { size: 11, font: bold }); y -= 16;
  for (const s of [...input.signers].sort((a, b) => a.order - b.order)) {
    text(`${s.order}.`, { size: 9.5, font: bold, color: MUTED });
    text(s.name, { x: M + 18, size: 10, font: bold });
    text(s.signedAt ? fmtUtc(s.signedAt) : "not signed", { x: M + W - 150, size: 9 });
    y -= 12;
    text(s.email, { x: M + 18, size: 8.5, color: MUTED });
    text(METHOD_LABEL[s.method ?? "type"] ?? "Typed signature", { x: M + W - 150, size: 8.5, color: MUTED });
    y -= 8;
    const img = await imageFor(s.image);
    if (img) {
      const h = 26, w = Math.min(140, (img.width / img.height) * h);
      page.drawImage(img, { x: M + 18, y: y - h, width: w, height: h });
      y -= h + 6;
    } else if (s.signedAt) {
      const t = safe(script, s.name);
      page.drawText(t, { x: M + 18, y: y - 18, size: fitSize(script, t, 200, 18), font: script, color: INK });
      y -= 28;
    }
    y -= 12;
    if (y < 260) break;
  }
  y -= 4; rule(); y -= 18;

  text("Evidence", { size: 11, font: bold }); y -= 16;
  const evidence: [string, string][] = [
    ["Seal digest (SHA-256)", input.sealDigest],
    [input.documentLabel, input.documentSha256],
    ["Seal timestamp", input.manifestTimestamp ? `RFC 3161, ${fmtUtc(input.manifestTimestamp.at)}, ${input.manifestTimestamp.tsa}` : "none"],
  ];
  for (const [k, v] of evidence) {
    text(k, { size: 8.5, color: MUTED });
    const font = /^[0-9a-f]{64}$/.test(v) ? mono : body;
    text(v, { x: M + 150, size: font === mono ? 7.6 : 8.5, font });
    y -= 14;
  }

  // QR code to the public verification page.
  const url = publicVerifyUrl(input.code);
  const qr = await pdf.embedPng(await QRCode.toBuffer(url, { type: "png", margin: 1, width: 300, errorCorrectionLevel: "M" }));
  const qrSize = 92;
  page.drawImage(qr, { x: M + W - qrSize, y: M + 44, width: qrSize, height: qrSize });
  y = M + 118;
  text("Verify this document", { size: 10, font: bold }); y -= 14;
  for (const line of wrap(body, `Scan the code or open ${url}. Your PDF reader's signature panel also shows whether any byte changed after sealing.`, 8.5, W - qrSize - 16)) {
    text(line, { size: 8.5, color: MUTED }); y -= 11;
  }
  y = M + 20;
  text(`Docurama SAS, 1 Rue Marguerin, 75014 Paris, France. Seal format docurama-seal/2, PDF signature PAdES (ETSI EN 319 142).`, { size: 6.5, color: MUTED });

  addSignaturePlaceholder(pdf, page, {
    name: input.identity.label,
    reason: `Sealed by Docurama after all signers completed (${input.code})`,
    location: input.tenantName,
    contactInfo: url,
    signingTime: input.sealedAt,
  });
  return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/** Uploaded PDF: stamp every placed value, then the certificate page. */
export async function composeSealedPdf(input: SealedPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input.original, { updateMetadata: false });
  const kit = await kitFor(pdf);
  const byEmail = new Map(input.signers.map((s) => [s.email.toLowerCase(), s]));
  const pages = pdf.getPages();
  for (const f of input.fields) {
    const page = pages[f.pageNumber - 1];
    const text = stampText(f);
    if (!page || !text) continue;
    const signer = f.recipientEmail ? byEmail.get(f.recipientEmail.toLowerCase()) : undefined;
    const isSignature = f.type === "signature";
    drawStamp(page, {
      ...f,
      value: text,
      image: isSignature ? await kit.imageFor(signer?.image ?? null) : null,
      caption: isSignature ? `Docurama ${input.code}${signer?.signedAt ? ` · ${fmtUtc(signer.signedAt)}` : ""}` : undefined,
    }, kit.fonts);
  }
  return finishSealedPdf(kit, { ...input, documentLabel: "Original document (SHA-256)" });
}

/* ── Template envelopes: the contract text as sent, typeset ────────────────── */

type Run = { text: string; font: PDFFont };

/** **bold**, *italic* and ***both*** inside one line of markdown. */
function inlineRuns(line: string, fonts: Kit["fonts"], base: "body" | "bold" = "body"): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index! > last) runs.push({ text: line.slice(last, m.index), font: fonts[base] });
    const token = m[0];
    if (token.startsWith("***")) runs.push({ text: token.slice(3, -3), font: fonts.boldItalic });
    else if (token.startsWith("**")) runs.push({ text: token.slice(2, -2), font: fonts.bold });
    else runs.push({ text: token.slice(1, -1), font: base === "bold" ? fonts.boldItalic : fonts.italic });
    last = m.index! + token.length;
  }
  if (last < line.length) runs.push({ text: line.slice(last), font: fonts[base] });
  return runs.map((r) => ({ ...r, text: safe(r.font, r.text) }));
}

/** Break styled runs into lines no wider than `width`. */
function layoutRuns(runs: Run[], size: number, width: number): { text: string; font: PDFFont; x: number }[][] {
  const lines: { text: string; font: PDFFont; x: number }[][] = [[]];
  let x = 0;
  for (const run of runs) {
    for (const piece of run.text.split(/(\s+)/)) {
      if (!piece) continue;
      const w = run.font.widthOfTextAtSize(piece, size);
      if (/^\s+$/.test(piece)) {
        if (x > 0) x += w;
        continue;
      }
      // Closing punctuation stays with the word before it.
      if (x > 0 && x + w > width && !/^[.,;:!?)\]»%]+$/.test(piece)) { lines.push([]); x = 0; }
      lines[lines.length - 1].push({ text: piece, font: run.font, x });
      x += w;
    }
  }
  return lines;
}

export type SealedTextInput = Omit<SealedPdfBase, "documentLabel"> & { contractText: string };

/**
 * Template envelope: the contract text exactly as sent, typeset on A4 pages,
 * then a signatures section (each adopted signature and the values each
 * signer entered), then the certificate page.
 */
export async function composeTemplateSealedPdf(input: SealedTextInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setProducer("Docurama");
  pdf.setCreator("Docurama");
  pdf.setCreationDate(input.sealedAt);
  pdf.setModificationDate(input.sealedAt);
  const kit = await kitFor(pdf);
  const { fonts } = kit;
  const [PW, PH, M] = [595.28, 841.89, 56];
  const W = PW - M * 2;
  let page = pdf.addPage([PW, PH]);
  let y = PH - M;
  const ensure = (needed: number) => {
    if (y - needed < M + 24) { page = pdf.addPage([PW, PH]); y = PH - M; }
  };
  const paragraph = (runs: Run[], size: number, opts: { indent?: number; gapAfter?: number; marker?: string } = {}) => {
    const indent = opts.indent ?? 0;
    const lines = layoutRuns(runs, size, W - indent);
    const lh = size * 1.45;
    lines.forEach((line, i) => {
      ensure(lh);
      y -= lh;
      if (i === 0 && opts.marker) page.drawText(opts.marker, { x: M + indent - 14, y, size, font: fonts.body, color: TEXT });
      for (const part of line) page.drawText(part.text, { x: M + indent + part.x, y, size, font: part.font, color: TEXT });
    });
    y -= opts.gapAfter ?? size * 0.6;
  };

  // Markdown blocks: headings, rules, list items, paragraphs (lines joined as the signing page shows them).
  const blocks: { kind: "h1" | "h2" | "h3" | "hr" | "li" | "p"; text: string; marker?: string }[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { blocks.push({ kind: "p", text: para.join(" ") }); para = []; } };
  for (const raw of input.contractText.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    let m: RegExpExecArray | null;
    if (!line) { flush(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flush(); blocks.push({ kind: "hr", text: "" }); continue; }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flush(); blocks.push({ kind: m[1].length === 1 ? "h1" : m[1].length === 2 ? "h2" : "h3", text: m[2] }); continue; }
    if ((m = /^(\d+[.)])\s+(.*)$/.exec(line))) { flush(); blocks.push({ kind: "li", text: m[2], marker: m[1] }); continue; }
    if ((m = /^[-*+]\s+(.*)$/.exec(line))) { flush(); blocks.push({ kind: "li", text: m[1], marker: "•" }); continue; }
    para.push(line);
  }
  flush();

  for (const b of blocks) {
    if (b.kind === "hr") { ensure(14); y -= 7; page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: RULE }); y -= 7; continue; }
    if (b.kind === "h1") { ensure(40); y -= 6; paragraph(inlineRuns(b.text, fonts, "bold"), 14, { gapAfter: 10 }); continue; }
    if (b.kind === "h2") { ensure(34); y -= 4; paragraph(inlineRuns(b.text, fonts, "bold"), 12, { gapAfter: 6 }); continue; }
    if (b.kind === "h3") { ensure(30); y -= 4; paragraph(inlineRuns(b.text, fonts, "bold"), 10.5, { gapAfter: 5 }); continue; }
    if (b.kind === "li") { paragraph(inlineRuns(b.text, fonts), 9.5, { indent: 18, marker: b.marker, gapAfter: 2 }); continue; }
    paragraph(inlineRuns(b.text, fonts), 9.5);
  }

  // Signatures: one block per signer, with the values they entered.
  ensure(60);
  y -= 16;
  page.drawText("Signatures", { x: M, y, size: 12, font: fonts.bold, color: TEXT });
  y -= 10;
  const valuesBy = new Map<string, { label: string; value: string }[]>();
  for (const f of input.fields ?? []) {
    if (!isEnteredField(f) || !f.value || !f.recipientEmail) continue;
    const list = valuesBy.get(f.recipientEmail.toLowerCase()) ?? [];
    list.push({ label: fieldLabel(f), value: f.value });
    valuesBy.set(f.recipientEmail.toLowerCase(), list);
  }
  for (const s of [...input.signers].sort((a, b) => a.order - b.order)) {
    const values = valuesBy.get(s.email.toLowerCase()) ?? [];
    ensure(96 + values.length * 13);
    y -= 14;
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: RULE });
    y -= 16;
    page.drawText(safe(fonts.bold, s.name), { x: M, y, size: 10, font: fonts.bold, color: TEXT });
    page.drawText(safe(fonts.body, s.email), { x: M, y: y - 12, size: 8.5, font: fonts.body, color: MUTED });
    const when = s.signedAt ? `Signed ${fmtUtc(s.signedAt)} · ${METHOD_LABEL[s.method ?? "type"] ?? "Typed signature"}` : "Not signed";
    page.drawText(safe(fonts.body, when), { x: M + W - fonts.body.widthOfTextAtSize(safe(fonts.body, when), 8.5), y, size: 8.5, font: fonts.body, color: MUTED });
    y -= 20;
    for (const v of values) {
      y -= 12;
      page.drawText(safe(fonts.body, `${v.label}: `), { x: M, y, size: 9, font: fonts.body, color: MUTED });
      page.drawText(safe(fonts.body, v.value), { x: M + fonts.body.widthOfTextAtSize(safe(fonts.body, `${v.label}: `), 9), y, size: 9, font: fonts.body, color: INK });
    }
    // The signature on its line.
    const box = { x: M, top: y - 6, width: 220, height: 40 };
    const img = await kit.imageFor(s.image);
    if (img) {
      const scale = Math.min(box.width / img.width, (box.height - 6) / img.height);
      page.drawImage(img, { x: box.x, y: box.top - box.height, width: img.width * scale, height: img.height * scale });
    } else if (s.signedAt) {
      const t = safe(fonts.script, s.name);
      page.drawText(t, { x: box.x, y: box.top - box.height + 8, size: fitSize(fonts.script, t, box.width, 22), font: fonts.script, color: INK });
    }
    y = box.top - box.height;
    page.drawLine({ start: { x: M, y }, end: { x: M + box.width, y }, thickness: 0.6, color: MUTED });
    y -= 9;
    page.drawText(safe(fonts.body, `Docurama ${input.code}`), { x: M, y, size: 6.5, font: fonts.body, color: MUTED });
  }

  // Page numbers on the contract pages.
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `${input.code} · page ${i + 1} of ${pages.length + 1}`;
    p.drawText(label, { x: PW - M - fonts.body.widthOfTextAtSize(label, 7), y: M / 2, size: 7, font: fonts.body, color: MUTED });
  });

  return finishSealedPdf(kit, { ...input, documentLabel: "Contract text as sent (SHA-256)" });
}

export type SealPdfOutcome =
  | { status: "SIGNED"; level: string; sha256: string }
  | { status: "ALREADY" }
  | { status: "SKIPPED"; reason: string }
  | { status: "FAILED"; reason: string };

/**
 * Produce and store the sealed PDF of a sealed envelope. Idempotent; never
 * throws (the seal already exists; this adds the signed copy).
 */
export async function sealEnvelopePdf(envelopeId: string): Promise<SealPdfOutcome> {
  const e = await db.envelope.findUnique({
    where: { id: envelopeId },
    include: { document: true, recipients: true, tenant: { select: { name: true } } },
  });
  if (!e || !e.sealedAt || !e.sha256 || e.status !== "COMPLETED") return { status: "SKIPPED", reason: "not sealed" };
  if (e.signedPdfKey) return { status: "ALREADY" };
  // A template envelope is typeset from its text snapshot; one sent before
  // snapshots existed has no reliable text (the template may have changed).
  if (!e.document && !e.contractText) return { status: "SKIPPED", reason: "no uploaded PDF and no contract text snapshot" };

  try {
    const identity = await getSealIdentity(e.tenantId);
    const tsa = await assignedTsa(e.tenantId);
    let fields: SealedPdfInput["fields"] = [];
    try { fields = e.fields ? JSON.parse(e.fields) : []; } catch { fields = []; }
    const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };

    const common = {
      code: e.publicCode, title: e.title, tenantName: e.tenant.name,
      sealedAt: e.sealedAt, sealDigest: e.sha256,
      manifestTimestamp: e.sealTimestampAt && e.sealTimestampTsa ? { at: e.sealTimestampAt, tsa: host(e.sealTimestampTsa) } : null,
      identity: { label: identity.label, issuer: identity.issuer.replace(/^.*?CN=([^,]+).*$/, "$1"), selfSigned: identity.selfSigned },
      signers: e.recipients.filter((r) => r.role === "SIGNER").map((r) => ({
        order: r.order, name: r.name, email: r.email, signedAt: r.signedAt,
        method: r.signatureMethod, font: r.signatureFont, image: r.signatureImage,
      })),
      fields: Array.isArray(fields) ? fields.filter((f) => f && typeof f.id === "string") : [],
    };
    let prepared: Uint8Array;
    if (e.document) {
      const original = await readStoredBytes(e.document.storageKey);
      if (createHash("sha256").update(original).digest("hex") !== e.document.sha256) {
        throw new Error("the stored file no longer matches its upload fingerprint");
      }
      prepared = await composeSealedPdf({ ...common, original, documentSha256: e.document.sha256 });
    } else {
      prepared = await composeTemplateSealedPdf({
        ...common, contractText: e.contractText!, documentSha256: createHash("sha256").update(e.contractText!, "utf8").digest("hex"),
      });
    }
    const signed = await signPdf(prepared, identity, { tsaUrl: tsa?.url ?? null });
    // B-T -> B-LT (validation data) -> B-LTA (document timestamp), when every proof is obtainable.
    let finalPdf = signed.pdf;
    let level: string = signed.level;
    let longTerm = "";
    let archiveExpires: Date | null = null;
    if (signed.level === "PAdES-B-T" && tsa) {
      const ltv = await extendToLongTerm(signed.pdf, { signerCms: signed.cms, extraCerts: identity.chainPems.map(pemToDer), tsaUrl: tsa.url });
      finalPdf = ltv.pdf;
      level = ltv.level;
      archiveExpires = ltv.archiveExpires;
      longTerm = ltv.level === "PAdES-B-T"
        ? `; not raised to B-LT: ${ltv.notes.join("; ").slice(0, 300)}`
        : `; validation data: ${ltv.validation.certs} certificate(s), ${ltv.validation.ocsps} OCSP response(s), ${ltv.validation.crls} CRL(s)` +
          (ltv.archiveTimestamp ? `; archive timestamp ${ltv.archiveTimestamp.toISOString()}` : `; ${ltv.notes.join("; ").slice(0, 200)}`);
    }
    const stored = await storeSealedPdf(e.tenantId, finalPdf);
    const signerText = `${identity.label} (${identity.selfSigned ? "self-signed" : `issued by ${identity.issuer}`}, SHA-256 ${identity.thumbprint.replace(/:/g, "").slice(0, 16).toLowerCase()})`;
    const now = new Date();
    await db.$transaction([
      db.envelope.update({
        where: { id: e.id },
        data: {
          signedPdfKey: stored.storageKey, signedPdfSha256: stored.sha256, signedPdfLevel: level, signedPdfSigner: signerText, signedPdfAt: now,
          signedPdfCheckAt: nextLongTermCheck(level, archiveExpires, now, now),
        },
      }),
      db.envelopeEvent.create({
        data: {
          envelopeId: e.id, actor: "Docurama", action: "PDF_SEALED",
          detail: `${level} signed PDF (${finalPdf.length} bytes, SHA-256 ${stored.sha256.slice(0, 12)}...) by ${signerText}` +
            (signed.timestamp ? `; signature timestamp ${host(signed.timestamp.tsaUrl)} ${signed.timestamp.genTime.toISOString()}` : signed.timestampError ? `; no signature timestamp: ${signed.timestampError.slice(0, 160)}` : "") +
            longTerm,
        },
      }),
    ]);
    return { status: "SIGNED", level, sha256: stored.sha256 };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[signed-pdf] ${e.publicCode}: ${reason}`);
    await db.envelopeEvent.create({
      data: { envelopeId: e.id, actor: "Docurama", action: "PDF_SEAL_FAILED", detail: `Sealed PDF not produced: ${reason.slice(0, 300)}` },
    }).catch(() => undefined);
    return { status: "FAILED", reason };
  }
}

/** The sealed PDF's bytes, producing it first when an earlier attempt failed. */
export async function sealedPdfBytes(envelopeId: string): Promise<{ bytes: Buffer; filename: string; level: string | null } | null> {
  let e = await db.envelope.findUnique({ where: { id: envelopeId }, include: { document: { select: { filename: true } } } });
  if (!e) return null;
  if (!e.signedPdfKey) {
    await sealEnvelopePdf(e.id);
    e = await db.envelope.findUnique({ where: { id: envelopeId }, include: { document: { select: { filename: true } } } });
    if (!e?.signedPdfKey) return null;
  }
  const base = (e.document?.filename || e.title).replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 100);
  return { bytes: await readSealedPdf(e.signedPdfKey), filename: `${base} (signed ${e.publicCode}).pdf`, level: e.signedPdfLevel };
}

/* ── Long-term upkeep ──────────────────────────────────────────────────────── */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Renew an archive timestamp this long before its TSA certificate expires. */
const RENEW_WINDOW_MS = 365 * DAY;
/** Retry a file stuck at B-T or B-LT for this long after sealing. */
const RETRY_FOR_MS = 30 * DAY;
/** A pass holds its envelope this long, so a second worker skips it. */
const LEASE_MS = 10 * MINUTE;

/** When the long-term pass should next look at a signed PDF (null: never). */
export function nextLongTermCheck(level: string | null, archiveExpires: Date | null, sealedAt: Date, now: Date): Date | null {
  if (level === "PAdES-B-LTA") {
    // At least a week apart, so a TSA that has not rotated its certificate yet is not asked daily.
    return archiveExpires ? new Date(Math.max(archiveExpires.getTime() - RENEW_WINDOW_MS, now.getTime() + 7 * DAY)) : null;
  }
  if (level === "PAdES-B-T" || level === "PAdES-B-LT") {
    const age = now.getTime() - sealedAt.getTime();
    if (age > RETRY_FOR_MS) return null;
    return new Date(now.getTime() + Math.min(DAY, Math.max(15 * MINUTE, age / 4)));
  }
  return null; // B-B: no signature timestamp, nothing can be added afterwards
}

type PassOutcome = "EXTENDED" | "RENEWED" | "NONE";

async function maintainOne(envelopeId: string, now: Date): Promise<PassOutcome> {
  const e = await db.envelope.findUnique({
    where: { id: envelopeId },
    select: { id: true, tenantId: true, publicCode: true, signedPdfKey: true, signedPdfSha256: true, signedPdfLevel: true, signedPdfAt: true, signedPdfRevisions: true },
  });
  if (!e?.signedPdfKey || !e.signedPdfSha256) return "NONE";
  const sealedAt = e.signedPdfAt ?? now;
  try {
    const pdf = await readSealedPdf(e.signedPdfKey);
    if (createHash("sha256").update(pdf).digest("hex") !== e.signedPdfSha256) {
      await db.$transaction([
        db.envelope.update({ where: { id: e.id }, data: { signedPdfCheckAt: null } }),
        db.envelopeEvent.create({ data: { envelopeId: e.id, actor: "Docurama", action: "PDF_LTV_FAILED", detail: "The stored signed PDF no longer matches its recorded SHA-256; long-term upkeep stopped." } }),
      ]);
      return "NONE";
    }
    const tsa = await assignedTsa(e.tenantId);
    const pass = await maintainLongTerm(pdf, { tsaUrl: tsa?.url ?? null, renewBefore: new Date(now.getTime() + RENEW_WINDOW_MS) });
    if (pass.action === "NONE") {
      const next = nextLongTermCheck(e.signedPdfLevel, pass.archiveExpires, sealedAt, now);
      await db.envelope.update({ where: { id: e.id }, data: { signedPdfCheckAt: next } });
      if (pass.notes.length) console.warn(`[signed-pdf] ${e.publicCode}: long-term pass: ${pass.notes.join("; ")}`);
      if (!next && (e.signedPdfLevel === "PAdES-B-T" || e.signedPdfLevel === "PAdES-B-LT")) {
        await db.envelopeEvent.create({
          data: { envelopeId: e.id, actor: "Docurama", action: "PDF_LTV_FAILED", detail: `Stays ${e.signedPdfLevel}: long-term validation data could not be obtained within 30 days (${pass.notes.join("; ").slice(0, 240)})` },
        });
      }
      return "NONE";
    }

    const stored = await storeSealedPdf(e.tenantId, pass.pdf);
    const revisions = [...signedPdfRevisions(e.signedPdfRevisions), { sha256: e.signedPdfSha256, bytes: pdf.length, level: e.signedPdfLevel, supersededAt: now.toISOString() }];
    // Conditional on the file we read: a concurrent pass that got there first wins.
    const updated = await db.envelope.updateMany({
      where: { id: e.id, signedPdfSha256: e.signedPdfSha256 },
      data: {
        signedPdfKey: stored.storageKey, signedPdfSha256: stored.sha256, signedPdfLevel: pass.level,
        signedPdfRevisions: JSON.stringify(revisions), signedPdfCheckAt: nextLongTermCheck(pass.level, pass.archiveExpires, sealedAt, now),
      },
    });
    if (!updated.count) return "NONE";
    const what = pass.action === "RENEWED"
      ? `Archive timestamp renewed ${pass.archiveTimestamp?.toISOString()}, before the previous one's TSA certificate expires`
      : `Raised from ${e.signedPdfLevel} to ${pass.level}`;
    await db.envelopeEvent.create({
      data: {
        envelopeId: e.id, actor: "Docurama", action: pass.action === "RENEWED" ? "PDF_ARCHIVE_RENEWED" : "PDF_LTV_EXTENDED",
        detail: `${what}; validation data: ${pass.validation.certs} certificate(s), ${pass.validation.ocsps} OCSP response(s), ${pass.validation.crls} CRL(s)` +
          (pass.action === "EXTENDED" && pass.archiveTimestamp ? `; archive timestamp ${pass.archiveTimestamp.toISOString()}` : "") +
          `; SHA-256 ${stored.sha256.slice(0, 12)}... (${pass.pdf.length} bytes). The earlier copy (SHA-256 ${e.signedPdfSha256.slice(0, 12)}...) is its first ${pdf.length} bytes and still verifies.`,
      },
    });
    return pass.action;
  } catch (error) {
    console.warn(`[signed-pdf] ${e.publicCode}: long-term pass failed`, error);
    // Storage or database trouble: try again tomorrow (B-T/B-LT keep their 30-day limit).
    const retry = e.signedPdfLevel === "PAdES-B-LTA" ? new Date(now.getTime() + DAY) : nextLongTermCheck(e.signedPdfLevel, null, sealedAt, now);
    await db.envelope.update({ where: { id: e.id }, data: { signedPdfCheckAt: retry } }).catch(() => undefined);
    return "NONE";
  }
}

/**
 * One worker pass: the signed PDFs whose long-term check is due, oldest first.
 * Each is claimed by moving its check time forward, so concurrent workers
 * (several app instances) never process the same file twice.
 */
export async function maintainSealedPdfs(opts: { limit?: number; now?: Date } = {}): Promise<{ checked: number; extended: number; renewed: number }> {
  const now = opts.now ?? new Date();
  const due = await db.envelope.findMany({
    where: { signedPdfCheckAt: { lte: now }, signedPdfKey: { not: null } },
    orderBy: { signedPdfCheckAt: "asc" }, take: opts.limit ?? 5,
    select: { id: true, signedPdfCheckAt: true },
  });
  const out = { checked: 0, extended: 0, renewed: 0 };
  for (const d of due) {
    const claimed = await db.envelope.updateMany({ where: { id: d.id, signedPdfCheckAt: d.signedPdfCheckAt }, data: { signedPdfCheckAt: new Date(now.getTime() + LEASE_MS) } });
    if (!claimed.count) continue;
    out.checked++;
    const outcome = await maintainOne(d.id, now);
    if (outcome === "EXTENDED") out.extended++;
    if (outcome === "RENEWED") out.renewed++;
  }
  return out;
}
