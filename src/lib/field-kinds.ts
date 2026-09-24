/**
 * Placed fields a signer fills in: one set of rules shared by the builder, the
 * signing page, the signing API and the sealed PDF, so they cannot disagree.
 *
 * Pure: no server imports (the signing page validates with it too; the server
 * validates again).
 *
 *   text      free text, up to 200 characters
 *   number    a number, like 1250 or 12,5
 *   select    one option from a dropdown
 *   radio     one option from a short list
 *   checkbox  ticked or not; required only when the sender says "must tick"
 *
 * signature, initials and date are stamped from the signing act itself.
 */

export const ENTERED_FIELD_TYPES = ["text", "number", "select", "radio", "checkbox"] as const;
export type EnteredFieldType = (typeof ENTERED_FIELD_TYPES)[number];

export type FieldRules = {
  type: string;
  label?: string;
  required?: boolean;
  options?: unknown;
  mustTick?: boolean;
};

export const isEnteredField = (f: { type: string }): f is { type: EnteredFieldType } =>
  (ENTERED_FIELD_TYPES as readonly string[]).includes(f.type);

/** Labels the builder puts on a new field: not meaningful to a signer. */
const GENERIC_LABELS = new Set(["Text Field", "Number", "Dropdown", "Radio", "Checkbox"]);
const TYPE_LABEL: Record<string, string> = { text: "Text", number: "Number", select: "Choice", radio: "Choice", checkbox: "Checkbox" };

/** What to call a field when talking to the signer. */
export function fieldLabel(f: FieldRules): string {
  return f.label && !GENERIC_LABELS.has(f.label) ? f.label : TYPE_LABEL[f.type] ?? "Field";
}

export const MAX_OPTIONS = 30;
export const MAX_OPTION_LENGTH = 80;

/** A dropdown or radio field's options: strings, trimmed, de-duplicated, bounded. */
export function fieldOptions(f: FieldRules): string[] {
  if (!Array.isArray(f.options)) return [];
  const seen = new Set<string>();
  for (const raw of f.options) {
    if (typeof raw !== "string") continue;
    const option = raw.trim().slice(0, MAX_OPTION_LENGTH);
    if (option) seen.add(option);
    if (seen.size >= MAX_OPTIONS) break;
  }
  return [...seen];
}

const NUMBER_RE = /^[-+]?\d{1,15}(?:[.,]\d{1,6})?$/;

export type EntryCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Check what a signer entered for one field and return the value to record.
 * Text, number and choices are required unless the sender made them optional;
 * a checkbox records "Yes" or "No".
 */
export function checkFieldEntry(f: FieldRules, raw: unknown): EntryCheck {
  const label = fieldLabel(f);
  if (f.type === "checkbox") {
    const ticked = raw === true || raw === "true" || raw === "Yes";
    if (f.mustTick === true && !ticked) return { ok: false, error: `Please tick "${label}" before signing.` };
    return { ok: true, value: ticked ? "Yes" : "No" };
  }
  const value = String(raw ?? "").trim().slice(0, f.type === "text" ? 200 : 120);
  const optional = f.required === false;
  if (!value) {
    if (optional) return { ok: true, value: "" };
    return { ok: false, error: f.type === "select" || f.type === "radio" ? `Please choose "${label}" before signing.` : `Please fill in "${label}" before signing.` };
  }
  if (f.type === "number" && !NUMBER_RE.test(value)) return { ok: false, error: `"${label}" must be a number, like 1250 or 12,5.` };
  if ((f.type === "select" || f.type === "radio") && !fieldOptions(f).includes(value)) {
    return { ok: false, error: `Choose one of the options for "${label}".` };
  }
  return { ok: true, value };
}

/** What the sealed PDF prints in the field's box (null: nothing). */
export function stampText(f: { type: string; value?: string }): string | null {
  if (!f.value) return null;
  if (f.type === "checkbox") return f.value === "Yes" ? "X" : null;
  return f.value;
}
