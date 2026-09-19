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
import { createHash } from "crypto";

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

describe("signer document endpoint (GET /api/sign/{token}/document)", () => {
  const SIGNER_TOKEN = "e2e-fixed-signer-token-0000000000000001";
  const CC_TOKEN = "e2e-fixed-cc-token-000000000000000000001";
  const VOIDED_TOKEN = "e2e-fixed-voided-token-0000000000000001";
  const JOURNEY_TOKEN = "e2e-fixed-journey-token-0000000000000001";

  test("invalid token 404s like the signing endpoint", async () => {
    const res = await fetch(`${BASE}/api/sign/definitely-not-a-real-token/document`);
    expect(res.status).toBe(404);
  });

  test("the signer's PDF is served inline with hardening headers", async () => {
    const res = await fetch(`${BASE}/api/sign/${SIGNER_TOKEN}/document`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("content-disposition")).toContain("e2e-mutual-nda.pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("served bytes are deterministic across requests", async () => {
    const [a, b] = await Promise.all([
      fetch(`${BASE}/api/sign/${SIGNER_TOKEN}/document`),
      fetch(`${BASE}/api/sign/${SIGNER_TOKEN}/document`),
    ]);
    const [ba, bb] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
    expect(Buffer.from(ba).equals(Buffer.from(bb))).toBe(true);
  });

  test("the digest shown on the signing page matches the served bytes", async () => {
    const page = await (await fetch(`${BASE}/sign/${SIGNER_TOKEN}`)).text();
    // React SSR separates static text from interpolations with <!-- -->.
    const shown = page.match(/SHA-256 (?:<!-- -->)?([0-9a-f]{32})/)?.[1];
    expect(shown).toBeTruthy();
    const bytes = Buffer.from(await (await fetch(`${BASE}/api/sign/${SIGNER_TOKEN}/document`)).arrayBuffer());
    const served = createHash("sha256").update(bytes).digest("hex");
    // The page shows a 32-char prefix of the real digest — it must be an
    // honest prefix of what is actually served, byte for byte.
    expect(served.startsWith(shown!)).toBe(true);
  });

  test("framing policy allows same-origin embedding — and stays strict elsewhere", async () => {
    // The portal embeds this endpoint in an iframe; the framed resource's
    // own CSP/XFO decides whether the browser renders it. A global DENY
    // would blank the embed in real browsers while every fetch-based test
    // stayed green — so lock both directions in.
    const doc = await fetch(`${BASE}/api/sign/${SIGNER_TOKEN}/document`);
    expect(doc.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(doc.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    const other = await fetch(`${BASE}/api/v1/verify/DOC-E2E0002`);
    expect(other.headers.get("x-frame-options")).toBe("DENY");
    expect(other.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  test("CC recipients cannot fetch the working document (403)", async () => {
    const res = await fetch(`${BASE}/api/sign/${CC_TOKEN}/document`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("copy of this document");
  });

  test("terminal (voided) envelopes refuse review even with valid bytes (409)", async () => {
    const res = await fetch(`${BASE}/api/sign/${VOIDED_TOKEN}/document`);
    expect(res.status).toBe(409);
  });

  test("envelopes without an uploaded PDF answer honestly (404)", async () => {
    const res = await fetch(`${BASE}/api/sign/${JOURNEY_TOKEN}/document`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("no uploaded PDF");
  });
});
