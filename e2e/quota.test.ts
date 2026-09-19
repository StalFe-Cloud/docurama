/// <reference types="bun-types" />

/**
 * Quota enforcement E2E — the billing engine's honest 402, with a real
 * session and a real API key belonging to a workspace whose allowance is
 * fully spent.
 *
 * Run: bun test e2e/quota.test.ts   (run.sh does this after seeding)
 *
 * The fixture tenant (e2e/seed.ts → "E2E Quota Ltd") is a SMART_TEAM
 * workspace with a negotiated limit of exactly one envelope and one envelope
 * already sent in the current billing window:
 *
 *  - workspace send must answer 402 with the honest allowance copy
 *    (what was used, that rollover is included, that an upgrade fixes it)
 *  - v1 reads with the same tenant's API key must stay 200 — quota gates
 *    sending, never reading
 *  - the 402 must not mutate anything: a second attempt gets the same answer
 */

import { describe, expect, test } from "bun:test";

const BASE = process.env.MAESTRO_BASE_URL ?? "http://127.0.0.1:3000";
const E2E_QUOTA_KEY = "dk_e2e_quota_000000000000000000000000000001";
const E2E_QUOTA_EMAIL = "e2e-quota@docurama.eu";
const E2E_QUOTA_PASSWORD = "e2eQuota1234!";

const login = async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: E2E_QUOTA_EMAIL, password: E2E_QUOTA_PASSWORD }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  if (!body.token) throw new Error(`quota fixture login failed: ${res.status}`);
  return body.token;
};

describe("spent-plan quota enforcement", () => {
  test("workspace send on an exhausted allowance answers 402 with the honest copy", async () => {
    const token = await login();
    const res = await fetch(`${BASE}/api/workspace/envelopes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        op: "send",
        data: {
          title: "Quota test — should be refused",
          recipients: [{ name: "Refused Recipient", email: "refused@example.com", role: "SIGNER" }],
        },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    expect(res.status).toBe(402);
    expect(body.error).toContain("allowance reached");
    // The copy must state what was spent and how to fix it — never a bare 402.
    expect(body.error).toContain("1/1");
    expect(body.error).toContain("Upgrade");
  });

  test("the 402 is stable — a second attempt mutates nothing", async () => {
    const token = await login();
    const res = await fetch(`${BASE}/api/workspace/envelopes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        op: "send",
        data: {
          title: "Quota test — second refusal",
          recipients: [{ name: "Refused Recipient", email: "refused@example.com", role: "SIGNER" }],
        },
      }),
    });
    expect(res.status).toBe(402);
  });

  test("v1 reads with the spent tenant's API key still answer 200", async () => {
    const res = await fetch(`${BASE}/api/v1/envelopes`, {
      headers: { "X-API-Key": E2E_QUOTA_KEY },
    });
    const body = (await res.json().catch(() => ({}))) as { total?: number };
    expect(res.status).toBe(200);
    expect(body.total).toBe(1); // the one envelope the plan allowed
  });

  test("the spent tenant's one envelope is still readable in detail", async () => {
    const res = await fetch(`${BASE}/api/v1/envelopes/DOC-E2EQTA1`, {
      headers: { "X-API-Key": E2E_QUOTA_KEY },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { envelope: { status: string } };
    expect(body.envelope.status).toBe("SENT");
  });
});
