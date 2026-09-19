/// <reference types="bun-types" />

/**
 * MCP endpoint E2E — the AI-agent surface at /api/mcp, driven with real HTTP.
 *
 * Run: bun test e2e/mcp.test.ts   (run.sh does this after seeding)
 *
 * Covers what browser flows cannot: X-API-Key auth (missing / invalid),
 * the discovery GET, JSON-RPC initialize / tools/list / tools/call against
 * real workspace fixtures, per-tenant tool allowlists (a tool outside the
 * allowlist is -32602), the unknown-tool path (-32601), unknown methods
 * (-32601), and the per-key per-minute rate limit (429).
 *
 * Fixtures come from e2e/seed.ts:
 *  - main e2e tenant: MCP enabled, all four tools, 120 req/min (suite key)
 *  - strict tenant e2e-mcp: allowlist "envelope_list,teleport", 10 req/min,
 *    two keys — functional key + a dedicated rate key whose bucket may be
 *    exhausted by earlier runs without breaking the functional assertions
 */

import { describe, expect, test } from "bun:test";

const BASE = process.env.MAESTRO_BASE_URL ?? "http://127.0.0.1:3000";
const E2E_API_KEY = "dk_e2e_0000000000000000000000000000000000000000";
const E2E_MCP_STRICT_KEY = "dk_e2e_mcp_strict_00000000000000000001";
const E2E_MCP_RATE_KEY = "dk_e2e_mcp_rate_000000000000000000000001";

type JsonRpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const rpc = async (payload: JsonRpc, key: string | null) => {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "X-API-Key": key } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
};

/** First text block of a tools/call result, parsed as JSON when possible. */
const toolText = (body: Record<string, unknown>): string => {
  const result = body.result as { content?: { type: string; text: string }[] } | undefined;
  return result?.content?.[0]?.text ?? "";
};

describe("MCP discovery (GET /api/mcp)", () => {
  test("describes the transport and auth without a key", async () => {
    const res = await fetch(`${BASE}/api/mcp`);
    const body = (await res.json()) as Record<string, string>;
    expect(res.status).toBe(200);
    expect(body.name).toBe("docurama");
    expect(body.transport).toBe("http-json-rpc");
    expect(body.authentication).toContain("X-API-Key");
  });
});

describe("MCP authentication", () => {
  test("missing key is rejected with 401", async () => {
    const { status, body } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, null);
    expect(status).toBe(401);
    expect(String(body.error)).toContain("X-API-Key");
  });

  test("invalid key is rejected with 401", async () => {
    const { status } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, "dk_totally_wrong");
    expect(status).toBe(401);
  });
});

describe("MCP JSON-RPC surface (enabled workspace)", () => {
  test("initialize returns protocol version and server info", async () => {
    const { status, body } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, E2E_API_KEY);
    expect(status).toBe(200);
    const result = body.result as { protocolVersion?: string; serverInfo?: { name?: string } };
    expect(result.protocolVersion).toBe("2025-03-26");
    expect(result.serverInfo?.name).toBe("docurama");
  });

  test("ping answers an empty result", async () => {
    const { status, body } = await rpc({ jsonrpc: "2.0", id: 2, method: "ping" }, E2E_API_KEY);
    expect(status).toBe(200);
    expect(body.result).toEqual({});
  });

  test("tools/list exposes exactly the four shipped tools", async () => {
    const { status, body } = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, E2E_API_KEY);
    expect(status).toBe(200);
    const tools = (body.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(tools.sort()).toEqual(["document_verify", "envelope_detail", "envelope_list", "template_list"]);
  });

  test("envelope_list returns the seeded fixtures", async () => {
    const { status, body } = await rpc(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "envelope_list", arguments: { perPage: 10 } } },
      E2E_API_KEY,
    );
    expect(status).toBe(200);
    const parsed = JSON.parse(toolText(body)) as { total: number; envelopes: { code: string }[] };
    expect(parsed.total).toBeGreaterThanOrEqual(5);
    const codes = parsed.envelopes.map((e) => e.code);
    expect(codes).toContain("DOC-E2E0001");
    expect(codes).toContain("DOC-E2E0002");
  });

  test("envelope_detail answers by public code with the timeline", async () => {
    const { status, body } = await rpc(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "envelope_detail", arguments: { idOrCode: "DOC-E2E0002" } } },
      E2E_API_KEY,
    );
    expect(status).toBe(200);
    const text = toolText(body);
    const parsed = JSON.parse(text) as { code: string; sha256: string; timeline: { action: string }[] };
    expect(parsed.code).toBe("DOC-E2E0002");
    expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.timeline.length).toBeGreaterThan(0);
    // SECURITY: the agent surface must never leak signing tokens.
    expect(text).not.toContain("accessToken");
  });

  test("envelope_detail on an unknown code is an honest in-band answer", async () => {
    const { status, body } = await rpc(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "envelope_detail", arguments: { idOrCode: "DOC-NOPE" } } },
      E2E_API_KEY,
    );
    expect(status).toBe(200);
    expect(toolText(body)).toContain("not found");
  });

  test("document_verify reports VERIFIED for the sealed fixture", async () => {
    const { status, body } = await rpc(
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "document_verify", arguments: { code: "DOC-E2E0002" } } },
      E2E_API_KEY,
    );
    expect(status).toBe(200);
    const parsed = JSON.parse(toolText(body)) as { result: string };
    expect(parsed.result).toBe("VERIFIED");
  });

  test("document_verify reports NOT_FOUND for unknown codes", async () => {
    const { status, body } = await rpc(
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "document_verify", arguments: { code: "DOC-NOPE" } } },
      E2E_API_KEY,
    );
    expect(status).toBe(200);
    expect(toolText(body)).toContain("NOT_FOUND");
  });

  test("template_list runs against the (empty) seeded workspace", async () => {
    const { status, body } = await rpc(
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "template_list", arguments: {} } },
      E2E_API_KEY,
    );
    expect(status).toBe(200);
    const parsed = JSON.parse(toolText(body)) as { templates: unknown[] };
    expect(Array.isArray(parsed.templates)).toBe(true);
  });

  test("a tool outside the workspace allowlist is -32602", async () => {
    const { body } = await rpc(
      { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "banana", arguments: {} } },
      E2E_API_KEY,
    );
    const error = body.error as { code: number; message: string };
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("not enabled");
  });

  test("an unknown JSON-RPC method is -32601", async () => {
    const { body } = await rpc({ jsonrpc: "2.0", id: 11, method: "resources/list" }, E2E_API_KEY);
    const error = body.error as { code: number; message: string };
    expect(error.code).toBe(-32601);
    expect(error.message).toContain("Method not found");
  });
});

describe("MCP per-tenant gating (strict tenant)", () => {
  test("tools/list shows only the allowed, existing tools", async () => {
    const { status, body } = await rpc({ jsonrpc: "2.0", id: 20, method: "tools/list" }, E2E_MCP_STRICT_KEY);
    expect(status).toBe(200);
    const tools = (body.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(tools).toEqual(["envelope_list"]); // teleport is allowlisted but not real
  });

  test("a real tool outside this tenant's allowlist is -32602", async () => {
    const { body } = await rpc(
      { jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "document_verify", arguments: { code: "DOC-E2E0002" } } },
      E2E_MCP_STRICT_KEY,
    );
    const error = body.error as { code: number; message: string };
    expect(error.code).toBe(-32602);
  });

  test("an allowlisted but unknown tool name is -32601", async () => {
    const { body } = await rpc(
      { jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "teleport", arguments: {} } },
      E2E_MCP_STRICT_KEY,
    );
    const error = body.error as { code: number; message: string };
    expect(error.code).toBe(-32601);
    expect(error.message).toContain("Unknown tool");
  });

  test("the tenant's own fixtures answer through its key", async () => {
    // e2e-mcp has no envelopes — an honest empty list, scoped to ITS workspace.
    const { status, body } = await rpc(
      { jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "envelope_list", arguments: {} } },
      E2E_MCP_STRICT_KEY,
    );
    expect(status).toBe(200);
    const parsed = JSON.parse(toolText(body)) as { total: number };
    expect(parsed.total).toBe(0);
  });

  test("per-key rate limit trips with 429", async () => {
    // Dedicated key: its in-memory bucket may already be exhausted by a
    // previous run against the same server process — both "trips on call N"
    // and "already tripped" are a pass; what must never happen is a run that
    // cannot reach 429 within the limit's budget.
    let saw429 = false;
    for (let i = 0; i < 12 && !saw429; i++) {
      const { status } = await rpc(
        { jsonrpc: "2.0", id: 30 + i, method: "tools/call", params: { name: "envelope_list", arguments: {} } },
        E2E_MCP_RATE_KEY,
      );
      if (status === 429) saw429 = true;
      else expect(status).toBe(200);
    }
    expect(saw429).toBe(true);
  });
});
