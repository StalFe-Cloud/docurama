import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

// Own process. Synthetic rows only, no Prisma/database/service/credentials.
let creates = 0;
let reservations = 0;
let saved: any;
const recipients = [
  { name: "Fixture", email: "signer@example.test", role: "SIGNER" },
  { name: "Copy", email: "copy@example.test", role: "CC" },
];
const field = { id: "field-1", type: "signature", pageNumber: 1, x: 10, y: 10, width: 25, height: 7, recipientIndex: 0, recipientEmail: "signer@example.test", required: true };
const db = {
  tenant: { findUnique: async () => ({ id: "tenant-one", status: "ACTIVE", esignPrefs: null }) },
  // Outbox-only fixture: the real resolver sees no tenant/platform identity.
  notificationSettings: { findUnique: async () => null },
  platformSetting: { findUnique: async () => null },
  domain: { findFirst: async () => null },
  member: { findFirst: async () => ({ id: "member-one" }) },
  document: { findFirst: async () => ({ id: "doc-one", pageCount: 2, sha256: "original-checksum" }) },
  template: { findFirst: async () => null, update: async () => {} },
  envelope: { create: async ({ data }: any) => { creates++; saved = data; return { id: "env-one", ...data }; } },
  recipient: { createMany: async () => {} },
  mailOutbox: { createMany: async () => {} },
  envelopeEvent: { createMany: async () => {} },
  $transaction: async (fn: any) => fn(db),
};
mock.module("../src/lib/db", () => ({ db }));
mock.module("../src/lib/auth", () => ({ requireUser: async () => ({ id: "owner-one", tenantId: "tenant-one", firstName: "Fixture", lastName: "Owner" }), recordAudit: async () => {} }));
mock.module("../src/lib/settings-handlers", () => ({ getSettingsSection: async () => {}, postSettingsOp: async () => {} }));
mock.module("../src/lib/transaction", () => ({ serializableTransaction: async (fn: any) => fn(db) }));
mock.module("../src/lib/billing", () => ({
  currentAllowance: async () => ({ used: 0, total: 100 }),
  reserveEnvelopeAllowance: async () => { reservations++; return {}; },
}));
mock.module("../src/lib/webhooks", () => ({ dispatchEnvelopeEvent: async () => {}, queueEnvelopeEvent: async () => {}, retryFailedDeliveries: async () => {} }));
mock.module("../src/lib/mail", () => ({ processOutbox: async () => {} }));
const dedicated = await import("../src/app/api/workspace/envelopes/route");
const legacy = await import("../src/app/api/workspace/[section]/route");
const malformed = [
  ["non-array", {}],
  ["oversized array", Array.from({ length: 201 }, (_, i) => ({ ...field, id: `field-${i}` }))],
  ["invalid type", [{ ...field, type: "unknown" }]],
  ["unsupported field type", [{ ...field, type: "select" }]],
  ["malformed required flag", [{ ...field, type: "checkbox", required: "yes" }]],
  ["invalid coordinate", [{ ...field, x: "10" }]],
  ["nonfinite coordinate", [{ ...field, x: Infinity }]],
  ["out-of-bounds field", [{ ...field, x: 99 }]],
  ["zero-size field", [{ ...field, width: 0 }]],
  ["out-of-page field", [{ ...field, pageNumber: 3 }]],
  ["fractional page", [{ ...field, pageNumber: 1.5 }]],
  ["unknown recipient", [{ ...field, recipientEmail: "other@example.test" }]],
  ["copy assignment", [{ ...field, recipientEmail: "copy@example.test", recipientIndex: 1 }]],
  ["recipient index mismatch", [{ ...field, recipientIndex: 1 }]],
  ["duplicate id", [field, field]],
  ["malformed label", [{ ...field, label: { nested: true } }]],
] as const;
beforeEach(() => { creates = 0; reservations = 0; saved = null; });
for (const [name, route] of [["dedicated", dedicated], ["legacy", legacy]] as const) {
  const send = (fields: unknown) => route.POST(new NextRequest("http://localhost/api/workspace/envelopes", {
    method: "POST", body: JSON.stringify({ op: "send", data: { title: "Synthetic document", documentId: "doc-one", recipients, fields } }),
  }), { params: Promise.resolve({ section: "envelopes" }) });
  describe(`${name} envelope field boundary`, () => {
    for (const [reason, fields] of malformed) test(`rejects ${reason} before durable work`, async () => {
      const response = await send(fields);
      expect(response.status).toBe(400);
      expect(creates).toBe(0);
      expect(reservations).toBe(0);
    });
    test("valid signature hints use authoritative signer identity and document pages", async () => {
      const response = await send([{ ...field, pageNumber: 2, recipientName: "Forged display name", extraProperty: "discard-me" }]);
      expect(response.status).toBe(200);
      const normalized = JSON.parse(saved.fields);
      expect(normalized[0].recipientName).toBe("Fixture");
      expect(normalized[0].extraProperty).toBeUndefined();
      expect(saved.pages).toBe(2);
      expect(saved.sha256).toBe("original-checksum");
      expect(reservations).toBe(1);
    });
  });
}
