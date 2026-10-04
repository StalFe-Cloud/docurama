import { describe, expect, test } from "bun:test";
import { EnvelopeFieldsError, parseEnvelopeFields, validateEnvelopeFields } from "../src/lib/envelope-fields";
const recipients = [
  { name: "First", email: "first@example.test", role: "SIGNER" },
  { name: "Copy", email: "copy@example.test", role: "CC" },
  { name: "Second", email: "second@example.test", role: "SIGNER" },
];
const context = { pageCount: 2, recipients };
const field = { id: "field-1", type: "signature", pageNumber: 2, x: 0, y: 0, width: 100, height: 100,
  recipientIndex: 1, recipientEmail: " SECOND@example.test ", required: true };

describe("signature location validation", () => {
  test("signer indexes exclude copy recipients and canonical identity comes from recipients", () => {
    const [normalized] = validateEnvelopeFields([{ ...field, recipientName: "forged" }], context);
    expect(normalized.recipientEmail).toBe("second@example.test");
    expect(normalized.recipientName).toBe("Second");
    expect(parseEnvelopeFields(JSON.stringify([normalized]), context)).toEqual([normalized]);
  });
  test("every numeric coordinate rejects nonfinite values without JSON coercion", () => {
    for (const key of ["x", "y", "width", "height"]) for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => validateEnvelopeFields([{ ...field, [key]: value }], context)).toThrow(EnvelopeFieldsError);
    }
  });
  test("raw and persisted payload budgets include discarded properties", () => {
    const oversized = [{ ...field, unused: "x".repeat(128 * 1024) }];
    expect(() => validateEnvelopeFields(oversized, context)).toThrow(EnvelopeFieldsError);
    expect(() => parseEnvelopeFields(JSON.stringify(oversized), context)).toThrow(EnvelopeFieldsError);
  });
  test("duplicate signer emails cannot ambiguously assign signature hints", () => {
    expect(() => validateEnvelopeFields([field], { ...context, recipients: [...recipients, { ...recipients[2] }] })).toThrow(EnvelopeFieldsError);
  });
});
