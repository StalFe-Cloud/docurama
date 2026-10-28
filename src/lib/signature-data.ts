import { StandardFontEmbedder, StandardFonts } from "pdf-lib";
import { assertConsentAcknowledgement, readConsentSnapshot, ConsentTermsError, type ConsentTerms } from "@/lib/consent";
import type { EnvelopeField } from "@/lib/envelope-fields";
export type SignatureAuthMethod = "EMAIL_LINK" | "EMAIL_OTP" | "SMS_OTP" | "EMAIL_AND_SMS_OTP" | "ACCOUNT_SESSION";
const AUTH_METHODS: readonly string[] = ["EMAIL_LINK", "EMAIL_OTP", "SMS_OTP", "EMAIL_AND_SMS_OTP", "ACCOUNT_SESSION"];
export type SignatureData = { version: 1 | 2; consentVersion?: string; consentDigest?: string; name: string; font: string; consent: string; consentAcceptedAt: string;
  authMethod: SignatureAuthMethod; values: Record<string, string | boolean>; drawnImage?: string };
export class SignatureDataError extends Error {}
function fail(message: string): never { throw new SignatureDataError(message); }

/* ── Hand-drawn signature images ────────────────────────────────────────────
 * A drawn signature is adopted as a PNG data URL produced by the signer's
 * own canvas. It is evidence (the exact marks the signer drew), so the data
 * URL is stored verbatim inside the adoption record and bound into the
 * envelope's evidence digest. Everything else about it is constrained:
 *   - PNG only (no SVG, no JPEG) — checked synchronously here via the PNG
 *     magic and IHDR dimensions, so capture stays a sync, cheap function,
 *   - bounded byte size (base64 URL <= 96 KB, decoded <= 72 KB) so a
 *     signatureData row stays well under its 128 KB read cap,
 *   - bounded pixel dimensions (<= 1200 x 600) so embedding cannot be used
 *     as a decompression bomb,
 *   - the full production embedPng proof runs inside the signing
 *     transaction via preflightSignatureDocument — the completion record
 *     embeds every drawn image — so a non-renderable image can never be
 *     committed and surface later as a failed post-seal download.
 */
export const DRAWN_IMAGE_PREFIX = "data:image/png;base64,";
export const MAX_DRAWN_DATA_URL_BYTES = 96 * 1024;
const MAX_DRAWN_DECODED_BYTES = 72 * 1024;
const MAX_DRAWN_PIXELS = { width: 1200, height: 600 };
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function checkedDrawnImage(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith(DRAWN_IMAGE_PREFIX)
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.slice(DRAWN_IMAGE_PREFIX.length))) {
    fail("The drawn signature could not be read. Draw it again, or type your name instead.");
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_DRAWN_DATA_URL_BYTES) {
    fail("The drawn signature is too large. Draw it again with simpler strokes, or type your name instead.");
  }
  return raw;
}

/** Decode and structurally verify: real PNG magic, sane IHDR dimensions. */
function checkedDrawnBytes(dataUrl: string): void {
  const decoded = Buffer.from(dataUrl.slice(DRAWN_IMAGE_PREFIX.length), "base64");
  if (decoded.length <= 24 || decoded.length > MAX_DRAWN_DECODED_BYTES
    || !decoded.subarray(0, 8).equals(PNG_MAGIC)
    || decoded.toString("latin1", 12, 16) !== "IHDR") {
    fail("The drawn signature is not a valid PNG image. Draw it again, or type your name instead.");
  }
  const width = decoded.readUInt32BE(16), height = decoded.readUInt32BE(20);
  if (width < 4 || height < 4 || width > MAX_DRAWN_PIXELS.width || height > MAX_DRAWN_PIXELS.height) {
    fail("The drawn signature has unsupported dimensions. Draw it again, or type your name instead.");
  }
}
function renderable(text: string): void {
  try { StandardFontEmbedder.for(StandardFonts.Helvetica as unknown as Parameters<typeof StandardFontEmbedder.for>[0]).encodeText(text); }
  catch { fail("This final PDF renderer cannot represent a character in your name or field values. Contact the sender."); }
}
export function captureSignatureData(body: Record<string, unknown>, fields: EnvelopeField[], email: string, at: Date, terms: ConsentTerms,
  authMethod: SignatureAuthMethod = "EMAIL_LINK"): SignatureData {
  try { assertConsentAcknowledgement(body, terms); }
  catch (error) { if (error instanceof ConsentTermsError) fail(error.message); throw error; }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 200) fail("Type your full name (2 to 200 characters).");
  renderable(name);
  // The drawn image, when the signer drew one: structurally validated here
  // (PNG magic, dimensions, size); the production embedPng proof runs in the
  // same signing transaction through preflightSignatureDocument.
  const hasDrawn = body.drawn !== undefined && body.drawn !== null && body.drawn !== "";
  const drawnImage = hasDrawn ? checkedDrawnImage(body.drawn) : undefined;
  if (drawnImage !== undefined) checkedDrawnBytes(drawnImage);
  const raw = body.values ?? {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Buffer.byteLength(JSON.stringify(raw), "utf8") > 128 * 1024) fail("Invalid field values.");
  const input = raw as Record<string, unknown>, own = fields.filter(f => f.recipientEmail.toLowerCase() === email.toLowerCase());
  if (Object.keys(input).some(id => !own.some(f => f.id === id))) fail("Field values must belong to this signer.");
  const values: Record<string, string | boolean> = Object.create(null);
  for (const field of own) {
    let value = Object.hasOwn(input, field.id) ? input[field.id] : undefined;
    if (field.type === "signature") value = name;
    if (field.type === "initials") value = name.split(/\s+/).map(p => p[0]).join("").slice(0, 20);
    if (field.type === "checkbox") {
      if (value === undefined) value = false;
      if (typeof value !== "boolean") fail("Checkbox values must be true or false.");
      if (field.required && !value) fail(`Complete required field: ${field.label}`);
    } else {
      if (value === undefined && !field.required) value = "";
      if (typeof value !== "string" || value.length > 2000 || (field.required && !value.trim())) fail(`Complete required field: ${field.label}`);
      if (field.type === "date" && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + "T00:00:00Z")) || new Date(value + "T00:00:00Z").toISOString().slice(0,10) !== value)) fail("Choose a valid calendar date.");
    }
    if (typeof value === "string") { if (/[\r\n]/.test(value)) fail("Document field values must fit a single line."); renderable(value); }
    values[field.id] = value as string | boolean;
  }
  return { version: 2, name, font: String(body.font ?? "caveat"), consent: terms.text,
    consentVersion: terms.version, consentDigest: terms.digest,
    consentAcceptedAt: at.toISOString(), authMethod, values,
    ...(drawnImage !== undefined ? { drawnImage } : {}) };
}
export function readSignatureData(raw: string | null | undefined): SignatureData {
  if (!raw || Buffer.byteLength(raw,"utf8") > 128 * 1024) fail("Historical signature adoption proof is unavailable.");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail("Invalid signature adoption evidence."); }
  const s = parsed as SignatureData;
  if (!s || ![1, 2].includes(s.version) || typeof s.name !== "string" || !s.name.trim() || typeof s.consent !== "string" || !s.consent ||
    !Number.isFinite(Date.parse(s.consentAcceptedAt)) || !AUTH_METHODS.includes(s.authMethod) || !s.values || typeof s.values !== "object" || Array.isArray(s.values)) fail("Invalid signature adoption evidence.");
  if (s.version === 2) {
    try { readConsentSnapshot(JSON.stringify({ schema: 1, text: s.consent, version: s.consentVersion, digest: s.consentDigest })); }
    catch (error) { if (error instanceof ConsentTermsError) fail("Invalid frozen consent in signature adoption evidence."); throw error; }
  }
  // Historical rows predate drawn images; new rows carry a bounded PNG data
  // URL that must stay structurally valid (render-time embedding enforces
  // the rest — capture already proved it embeddable before commit).
  if (s.drawnImage !== undefined) {
    if (typeof s.drawnImage !== "string" || !s.drawnImage.startsWith(DRAWN_IMAGE_PREFIX)
      || Buffer.byteLength(s.drawnImage, "utf8") > MAX_DRAWN_DATA_URL_BYTES) {
      fail("Invalid signature adoption evidence.");
    }
  }
  return s; // Version 1 historical wording is retained verbatim, never rewritten.
}
