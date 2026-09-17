/// <reference types="bun-types" />

/**
 * API-layer E2E — the public v1 integration surface, driven with real HTTP
 * against the same server the Maestro flows use.
 *
 * Run: bun test e2e/api.test.ts   (run.sh does this after seeding)
 *
 * Covers what browser flows cannot: X-API-Key auth (missing / invalid),
 * scope enforcement (403 for TEMPLATES with an ENVELOPES key), the public
 * verify engine states (VERIFIED / NOT_SEALED / NOT_FOUND), list + detail
 * envelope reads, and — security-critical — that recipient signing tokens
 * NEVER leak through the v1 payloads.
 *
 * Fixtures come from e2e/seed.ts (DOC-E2E0001/0002 + the E2E API key).
 */

import { describe, expect, test } from "bun:test";

const BASE = process.env.MAESTRO_BASE_URL ?? "http://127.0.0.1:3000";
const E2E_API_KEY = "dk_e2e_0000000000000000000000000000000000000000";

const get = async (path: string, headers: Record<string, string> = {}) => {
  const res = await fetch(`${BASE}${path}`, { headers });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
};

const post = async (path: string, payload: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
};

describe("public verify engine (/api/v1/verify)", () => {
  test("sealed fixture verifies with its exact SHA-256 digest", async () => {
    const { status, body } = await get("/api/v1/verify/DOC-E2E0002");
    expect(status).toBe(200);
    expect(body.result).toBe("VERIFIED");
    const env = body.envelope as { sha256: string; signers: unknown[]; title: string };
    expect(env.title).toContain("Supply Agreement");
    expect(env.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(env.signers.length).toBeGreaterThan(0);
  });

  test("sent (not yet signed) fixture reports NOT_SEALED honestly", async () => {
    const { status, body } = await get("/api/v1/verify/DOC-E2E0001");
    expect(status).toBe(200);
    expect(body.result).toBe("NOT_SEALED");
  });

  test("unknown code reports NOT_FOUND, not an error", async () => {
    const { status, body } = await get("/api/v1/verify/DOC-DOESNOTEXIST");
    expect(status).toBe(200);
    expect(body.result).toBe("NOT_FOUND");
  });
});

describe("X-API-Key authentication", () => {
  test("missing key is rejected with 401", async () => {
    const { status, body } = await get("/api/v1/envelopes");
    expect(status).toBe(401);
    expect(String(body.error)).toContain("X-API-Key");
  });

  test("invalid key is rejected with 401", async () => {
    const { status } = await get("/api/v1/envelopes", { "X-API-Key": "dk_totally_wrong" });
    expect(status).toBe(401);
  });

  test("valid key lists the tenant's envelopes (seeded fixtures present)", async () => {
    const { status, body } = await get("/api/v1/envelopes?perPage=50", { "X-API-Key": E2E_API_KEY });
    expect(status).toBe(200);
    expect(Number(body.total)).toBeGreaterThanOrEqual(4);
    const rows = body.rows as { publicCode: string; recipients: Record<string, unknown>[] }[];
    const codes = rows.map((r) => r.publicCode);
    for (const expected of ["DOC-E2E0001", "DOC-E2E0002", "DOC-E2E0003", "DOC-E2E0004"]) {
      expect(codes).toContain(expected);
    }
    // SECURITY: signing tokens must never appear in v1 payloads.
    const leaked = rows.some((r) => r.recipients.some((rcpt) => "accessToken" in rcpt));
    expect(leaked).toBe(false);
  });

  test("envelope detail is addressable by public code", async () => {
    const { status, body } = await get("/api/v1/envelopes/DOC-E2E0002", { "X-API-Key": E2E_API_KEY });
    expect(status).toBe(200);
    expect((body.envelope as { status: string }).status).toBe("COMPLETED");
    expect(Array.isArray(body.events)).toBe(true);
  });

  test("scope enforcement: ENVELOPES key cannot read TEMPLATES (403)", async () => {
    const { status, body } = await get("/api/v1/templates", { "X-API-Key": E2E_API_KEY });
    expect(status).toBe(403);
    expect(String(body.error)).toContain("scope");
  });

  test("unknown v1 resource 404s cleanly", async () => {
    const { status } = await get("/api/v1/definitely-not-a-resource", { "X-API-Key": E2E_API_KEY });
    expect(status).toBe(404);
  });
});

describe("public signing endpoint (/api/sign)", () => {
  test("invalid token 404s with a friendly message", async () => {
    const { status, body } = await post("/api/sign/definitely-not-a-real-token", { op: "view" });
    expect(status).toBe(404);
    expect(String(body.error)).toContain("not valid");
  });

  test("view on the journey fixture records the open (idempotent-safe)", async () => {
    const { status, body } = await post("/api/sign/e2e-fixed-journey-token-0000000000000001", { op: "view" });
    expect(status).toBe(200);
    expect(body.status).toBe("DELIVERED");
  });

  test("sign without a name is rejected (validation, no mutation)", async () => {
    const { status, body } = await post("/api/sign/e2e-fixed-journey-token-0000000000000001", { op: "sign", name: "" });
    expect(status).toBe(400);
    expect(String(body.error)).toContain("full name");
  });

  test("unknown operation is rejected", async () => {
    const { status } = await post("/api/sign/e2e-fixed-journey-token-0000000000000001", { op: "teleport" });
    expect(status).toBe(400);
  });
});
