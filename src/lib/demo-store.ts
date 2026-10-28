/**
 * Client-side demo data layer.
 *
 * The original platform serves these shapes from Next.js API routes backed by
 * Prisma. This port runs without a backend (per project decision), so the
 * same endpoints are answered from a seeded, localStorage-persisted store.
 * All data is fictional sample data.
 */

import type { SessionUser } from "@/lib/auth";

const STORE_KEY = "docurama_demo_v2";

export class DemoError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Recipient = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  signedAt: string | null;
  declinedAt?: string | null;
  token: string;
  order: number;
};

type Envelope = {
  id: string;
  publicCode: string;
  title: string;
  status: string;
  tenantName: string;
  createdBy: string;
  createdAt: string;
  sealedAt: string | null;
  completedAt: string | null;
  conformanceLevel: string | null;
  sha256: string | null;
  pages: number;
  lastRemindedAt: string | null;
  voidReason: string | null;
  attestedAt: string | null;
  attestStatus: string | null;
  verifiedSenderDomain: string | null;
  recipients: Recipient[];
  events: { id: string; at: string; actor: string; action: string; detail: string | null; ipHash: string | null }[];
};

type Template = {
  id: string;
  name: string;
  pages: number;
  category: string;
  folder: string;
  publicSlug?: string;
  updatedAt: string;
  usedCount: number;
};

type Store = {
  envelopes: Envelope[];
  templates: Template[];
  leads: { id: string; company: string; email: string; name: string; status: string; createdAt: string; message: string }[];
  users: { id: string; email: string; firstName: string; lastName: string; role: string; tenantName: string; createdAt: string; lastSignInAt: string | null; status: string }[];
  tenants: { id: string; name: string; slug: string; planCode: string; createdAt: string; members: number; envelopes: number }[];
  domains: { id: string; domain: string; tenantName: string; verified: boolean; createdAt: string }[];
  audit: { id: string; at: string; actor: string; actorRole: string; action: string; resource: string; target: string; tenantName: string | null; severity: string; ip: string; detail: string | null }[];
};

function daysAgo(n: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 12, 0, 0);
  return d.toISOString();
}

function sha(id: string): string {
  // Deterministic demo digest (not a real hash of document bytes).
  let h = 0x811c9dc5;
  const s = `docurama-demo-${id}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const part = (seed: number) => (seed >>> 0).toString(16).padStart(8, "0");
  return (part(h) + part(h * 7 + 1) + part(h * 13 + 2) + part(h * 29 + 3) + part(h * 43 + 4) + part(h * 59 + 5) + part(h * 71 + 6) + part(h * 97 + 7)).slice(0, 64);
}

function recipient(id: string, name: string, email: string, role: string, status: string, order: number, signedAt: string | null): Recipient {
  return { id, name, email, role, status, signedAt, token: `demo-sign-${id}`, order };
}

function seed(): Store {
  const envelopes: Envelope[] = [
    {
      id: "env-001", publicCode: "DC-2026-4815", title: "Consulting agreement - Acme Industries", status: "COMPLETED",
      tenantName: "Docurama Demo", createdBy: "sriram@docurama.eu", createdAt: daysAgo(21), sealedAt: daysAgo(19), completedAt: daysAgo(19),
      conformanceLevel: "SES", sha256: sha("env-001"), pages: 8, lastRemindedAt: null, voidReason: null,
      attestedAt: daysAgo(19), attestStatus: "ATTESTED", verifiedSenderDomain: "docurama.eu",
      recipients: [
        recipient("r-001a", "Sriram Rajan", "sriram@docurama.eu", "SENDER", "SIGNED", 1, daysAgo(20)),
        recipient("r-001b", "Claire Dubois", "claire@acme.example", "SIGNER", "SIGNED", 2, daysAgo(19)),
      ],
      events: [
        { id: "ev-001a", at: daysAgo(21), actor: "sriram@docurama.eu", action: "ENVELOPE_CREATED", detail: "Consulting agreement - Acme Industries", ipHash: "9f2c" },
        { id: "ev-001b", at: daysAgo(21, 11), actor: "claire@acme.example", action: "INVITATION_SENT", detail: null, ipHash: null },
        { id: "ev-001c", at: daysAgo(20), actor: "sriram@docurama.eu", action: "SIGNED", detail: "Typed adoption", ipHash: "9f2c" },
        { id: "ev-001d", at: daysAgo(19), actor: "claire@acme.example", action: "CONSENT_GIVEN", detail: "v1.0", ipHash: "41ab" },
        { id: "ev-001e", at: daysAgo(19, 14), actor: "claire@acme.example", action: "SIGNED", detail: "Drawn signature", ipHash: "41ab" },
        { id: "ev-001f", at: daysAgo(19, 15), actor: "system", action: "ENVELOPE_COMPLETED", detail: "Evidence pack sealed", ipHash: null },
      ],
    },
    {
      id: "env-002", publicCode: "DC-2026-4920", title: "NDA - Lighthouse Ventures", status: "PARTIALLY_SIGNED",
      tenantName: "Docurama Demo", createdBy: "sriram@docurama.eu", createdAt: daysAgo(6), sealedAt: null, completedAt: null,
      conformanceLevel: "SES", sha256: null, pages: 4, lastRemindedAt: daysAgo(2), voidReason: null,
      attestedAt: null, attestStatus: null, verifiedSenderDomain: "docurama.eu",
      recipients: [
        recipient("r-002a", "Sriram Rajan", "sriram@docurama.eu", "SENDER", "SIGNED", 1, daysAgo(6)),
        recipient("r-002b", "Marc Lefevre", "marc@lighthouse.example", "SIGNER", "SENT", 2, null),
      ],
      events: [
        { id: "ev-002a", at: daysAgo(6), actor: "sriram@docurama.eu", action: "ENVELOPE_CREATED", detail: null, ipHash: "9f2c" },
        { id: "ev-002b", at: daysAgo(6, 12), actor: "sriram@docurama.eu", action: "SIGNED", detail: "Typed adoption", ipHash: "9f2c" },
        { id: "ev-002c", at: daysAgo(2), actor: "system", action: "REMINDER_SENT", detail: "marc@lighthouse.example", ipHash: null },
      ],
    },
    {
      id: "env-003", publicCode: "DC-2026-4955", title: "Employment contract - A. Martin", status: "SENT",
      tenantName: "Docurama Demo", createdBy: "sriram@docurama.eu", createdAt: daysAgo(3), sealedAt: null, completedAt: null,
      conformanceLevel: "SES", sha256: null, pages: 12, lastRemindedAt: null, voidReason: null,
      attestedAt: null, attestStatus: null, verifiedSenderDomain: "docurama.eu",
      recipients: [recipient("r-003a", "Alice Martin", "alice.martin@example.com", "SIGNER", "SENT", 1, null)],
      events: [
        { id: "ev-003a", at: daysAgo(3), actor: "sriram@docurama.eu", action: "ENVELOPE_CREATED", detail: null, ipHash: "9f2c" },
        { id: "ev-003b", at: daysAgo(3, 11), actor: "alice.martin@example.com", action: "INVITATION_SENT", detail: null, ipHash: null },
      ],
    },
    {
      id: "env-004", publicCode: "DC-2026-4702", title: "Supplier framework agreement", status: "COMPLETED",
      tenantName: "Docurama Demo", createdBy: "sriram@docurama.eu", createdAt: daysAgo(40), sealedAt: daysAgo(33), completedAt: daysAgo(33),
      conformanceLevel: "SES", sha256: sha("env-004"), pages: 22, lastRemindedAt: null, voidReason: null,
      attestedAt: daysAgo(33), attestStatus: "ATTESTED", verifiedSenderDomain: "docurama.eu",
      recipients: [
        recipient("r-004a", "Sriram Rajan", "sriram@docurama.eu", "SENDER", "SIGNED", 1, daysAgo(38)),
        recipient("r-004b", "Hans Weber", "h.weber@supplier.example", "SIGNER", "SIGNED", 2, daysAgo(33)),
      ],
      events: [
        { id: "ev-004a", at: daysAgo(40), actor: "sriram@docurama.eu", action: "ENVELOPE_CREATED", detail: null, ipHash: "9f2c" },
        { id: "ev-004b", at: daysAgo(33), actor: "h.weber@supplier.example", action: "SIGNED", detail: "Typed adoption", ipHash: "77c1" },
        { id: "ev-004c", at: daysAgo(33, 16), actor: "system", action: "ENVELOPE_COMPLETED", detail: null, ipHash: null },
      ],
    },
    {
      id: "env-005", publicCode: "DC-2026-4630", title: "Partnership proposal - Nordwind", status: "DECLINED",
      tenantName: "Docurama Demo", createdBy: "sriram@docurama.eu", createdAt: daysAgo(55), sealedAt: null, completedAt: null,
      conformanceLevel: "SES", sha256: null, pages: 6, lastRemindedAt: null, voidReason: null,
      attestedAt: null, attestStatus: null, verifiedSenderDomain: "docurama.eu",
      recipients: [recipient("r-005a", "Ingrid Larsen", "ingrid@nordwind.example", "SIGNER", "DECLINED", 1, null)],
      events: [
        { id: "ev-005a", at: daysAgo(55), actor: "sriram@docurama.eu", action: "ENVELOPE_CREATED", detail: null, ipHash: "9f2c" },
        { id: "ev-005b", at: daysAgo(50), actor: "ingrid@nordwind.example", action: "DECLINED", detail: "Terms under renegotiation", ipHash: "b201" },
      ],
    },
    {
      id: "env-006", publicCode: "DC-2026-5001", title: "DPA - Cloud hosting addendum", status: "SENT",
      tenantName: "Docurama Demo", createdBy: "sriram@docurama.eu", createdAt: daysAgo(1), sealedAt: null, completedAt: null,
      conformanceLevel: "SES", sha256: null, pages: 9, lastRemindedAt: null, voidReason: null,
      attestedAt: null, attestStatus: null, verifiedSenderDomain: "docurama.eu",
      recipients: [recipient("r-006a", "Data Protection Office", "dpo@hoster.example", "SIGNER", "SENT", 1, null)],
      events: [{ id: "ev-006a", at: daysAgo(1), actor: "sriram@docurama.eu", action: "ENVELOPE_CREATED", detail: null, ipHash: "9f2c" }],
    },
  ];

  const templates: Template[] = [
    { id: "tpl-001", name: "Mutual NDA", pages: 4, category: "Legal", folder: "Legal", publicSlug: "mutual-nda", updatedAt: daysAgo(30), usedCount: 18 },
    { id: "tpl-002", name: "Consulting agreement", pages: 8, category: "Services", folder: "Services", publicSlug: "consulting-agreement", updatedAt: daysAgo(25), usedCount: 11 },
    { id: "tpl-003", name: "Employment contract (FR)", pages: 12, category: "HR", folder: "HR", publicSlug: "employment-contract-fr", updatedAt: daysAgo(14), usedCount: 6 },
    { id: "tpl-004", name: "Data processing agreement", pages: 9, category: "Compliance", folder: "Compliance", publicSlug: "dpa", updatedAt: daysAgo(10), usedCount: 4 },
    { id: "tpl-005", name: "Supplier framework agreement", pages: 22, category: "Procurement", folder: "Procurement", publicSlug: "supplier-framework", updatedAt: daysAgo(7), usedCount: 2 },
  ];

  return {
    envelopes,
    templates,
    leads: [
      { id: "lead-001", company: "Notaires Associes", email: "contact@notaires-associes.example", name: "Pierre Bernard", status: "NEW", createdAt: daysAgo(4), message: "400 notarial deeds per month, need QES roadmap." },
      { id: "lead-002", company: "MediTrial SAS", email: "ops@meditrial.example", name: "Sofia Ricci", status: "CONTACTED", createdAt: daysAgo(9), message: "Part 11 validation pack request." },
      { id: "lead-003", company: "Banque Regionale", email: "digital@banque-regionale.example", name: "Julien Perrot", status: "QUALIFIED", createdAt: daysAgo(16), message: "Self-hosted tier, air-gapped evaluation." },
    ],
    users: [
      { id: "u-001", email: "sriram@docurama.eu", firstName: "Sriram", lastName: "Rajan", role: "PLATFORM_ADMIN", tenantName: "Docurama Demo", createdAt: daysAgo(120), lastSignInAt: daysAgo(0, 8), status: "ACTIVE" },
      { id: "u-002", email: "claire@acme.example", firstName: "Claire", lastName: "Dubois", role: "USER", tenantName: "Acme Industries", createdAt: daysAgo(60), lastSignInAt: daysAgo(19), status: "ACTIVE" },
      { id: "u-003", email: "marc@lighthouse.example", firstName: "Marc", lastName: "Lefevre", role: "USER", tenantName: "Lighthouse Ventures", createdAt: daysAgo(45), lastSignInAt: null, status: "INVITED" },
    ],
    tenants: [
      { id: "t-001", name: "Docurama Demo", slug: "demo", planCode: "BUSINESS", createdAt: daysAgo(120), members: 3, envelopes: 6 },
      { id: "t-002", name: "Acme Industries", slug: "acme", planCode: "STARTER", createdAt: daysAgo(60), members: 4, envelopes: 21 },
      { id: "t-003", name: "Lighthouse Ventures", slug: "lighthouse", planCode: "SOLO", createdAt: daysAgo(45), members: 1, envelopes: 3 },
    ],
    domains: [
      { id: "d-001", domain: "docurama.eu", tenantName: "Docurama Demo", verified: true, createdAt: daysAgo(120) },
      { id: "d-002", domain: "acme.example", tenantName: "Acme Industries", verified: false, createdAt: daysAgo(12) },
    ],
    audit: [
      { id: "a-001", at: daysAgo(0, 8), actor: "sriram@docurama.eu", actorRole: "PLATFORM_ADMIN", action: "SESSION_CREATED", resource: "u-001", target: "u-001", tenantName: "Docurama Demo", severity: "INFO", ip: "90.12.44.201", detail: "Sign-in from Paris, FR" },
      { id: "a-002", at: daysAgo(1), actor: "sriram@docurama.eu", actorRole: "PLATFORM_ADMIN", action: "ENVELOPE_CREATED", resource: "env-006", target: "env-006", tenantName: "Docurama Demo", severity: "INFO", ip: "90.12.44.201", detail: "DPA - Cloud hosting addendum" },
      { id: "a-003", at: daysAgo(2), actor: "system", actorRole: "SYSTEM", action: "REMINDER_SENT", resource: "env-002", target: "env-002", tenantName: "Docurama Demo", severity: "INFO", ip: "", detail: "marc@lighthouse.example" },
      { id: "a-004", at: daysAgo(5), actor: "unknown", actorRole: "ANONYMOUS", action: "LOGIN_FAILED", resource: "admin@docurama.eu", target: "admin@docurama.eu", tenantName: null, severity: "WARNING", ip: "203.0.113.88", detail: "3 failed attempts, throttled" },
      { id: "a-005", at: daysAgo(12), actor: "claire@acme.example", actorRole: "USER", action: "DOMAIN_ADDED", resource: "acme.example", target: "acme.example", tenantName: "Acme Industries", severity: "INFO", ip: "82.66.10.14", detail: "Verification pending" },
    ],
  };
}

function load(): Store {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    // fall through to seed
  }
  const fresh = seed();
  save(fresh);
  return fresh;
}

function save(store: Store) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable; keep in-memory only.
  }
}

export const DEMO_USER: SessionUser = {
  id: "u-001",
  email: "sriram@docurama.eu",
  firstName: "Sriram",
  lastName: "Rajan",
  role: "PLATFORM_ADMIN",
  totpEnabled: false,
  tenantId: "t-001",
  tenantName: "Docurama Demo",
  tenantSlug: "demo",
  tenantPlan: "BUSINESS",
  workspaceRole: "OWNER",
  sessionId: "sess-demo-001",
  orgs: [
    { id: "t-001", name: "Docurama Demo", slug: "demo", plan: "BUSINESS", role: "OWNER" },
    { id: "t-002", name: "Acme Industries", slug: "acme", plan: "STARTER", role: "MEMBER" },
  ],
};

export const DEMO_SIGN_TOKEN = "demo-sign-r-002b";

function paged<T>(rows: T[], page: number, perPage: number) {
  const start = (page - 1) * perPage;
  return { rows: rows.slice(start, start + perPage), total: rows.length, perPage };
}

function matches(text: string, q: string) {
  return text.toLowerCase().includes(q.toLowerCase());
}

/** Answer a portal API request from the demo store. Mirrors the original /api surface. */
export async function demoRequest(method: string, rawPath: string, body?: unknown): Promise<unknown> {
  // Simulate network latency so loading states remain visible.
  await new Promise((r) => setTimeout(r, 120));

  const [path, queryString] = rawPath.split("?");
  const params = new URLSearchParams(queryString ?? "");
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const perPage = Math.max(1, Number(params.get("perPage") ?? "10") || 10);
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "ALL";
  const store = load();

  // ---- Auth ----
  if (path === "/api/auth/me") {
    let token: string | null = null;
    try {
      token = window.localStorage.getItem("docurama_token");
    } catch {
      token = null;
    }
    return { user: token ? DEMO_USER : null };
  }
  if (path === "/api/auth/login" && method === "POST") {
    const creds = (body ?? {}) as { email?: string; password?: string };
    if (!creds.email || !creds.password) throw new DemoError("Email and password are required", 400);
    return { ok: true, token: "demo-token", user: DEMO_USER };
  }
  if (path === "/api/auth/signup" && method === "POST") {
    return { ok: true, token: "demo-token", user: DEMO_USER, message: "Workspace created. Welcome to Docurama." };
  }
  if (path === "/api/auth/logout") return { ok: true };
  if (path === "/api/auth/check-domain" && method === "POST") return { ok: true, sso: null };
  if (path === "/api/auth/forgot-password" && method === "POST") {
    return { ok: true, message: "If that address has an account, a reset link is on its way." };
  }
  if (path === "/api/auth/reset-password" && method === "POST") return { ok: true, message: "Password updated. You can sign in now." };
  if (path === "/api/auth/verify-email" && method === "POST") return { ok: true };
  if (path === "/api/auth/resend-verification" && method === "POST") return { ok: true };

  // ---- Workspace ----
  if (path === "/api/workspace/overview") {
    const open = store.envelopes.filter((e) => e.status === "SENT" || e.status === "PARTIALLY_SIGNED");
    const completed = store.envelopes.filter((e) => e.status === "COMPLETED");
    return {
      tenant: { name: "Docurama Demo", slug: "demo", planCode: "BUSINESS" },
      plan: { name: "Business", monthlyEur: 49 },
      quota: { used: store.envelopes.length, total: 100, limit: 100 },
      counts: {
        open: open.length,
        completed: completed.length,
        templates: store.templates.length,
        awaitingMe: 1,
      },
      recent: store.envelopes.slice(0, 5),
      myQueue: store.envelopes.filter((e) => e.status === "SENT").slice(0, 5),
      stats: Array.from({ length: 14 }, (_, i) => ({ date: daysAgo(13 - i).slice(0, 10), sent: (i * 7) % 4, completed: (i * 5) % 3 })),
    };
  }
  if (path === "/api/workspace/envelopes") {
    let rows = store.envelopes;
    if (status !== "ALL") rows = rows.filter((e) => e.status === status);
    if (q) rows = rows.filter((e) => matches(e.title, q) || matches(e.publicCode, q));
    return { ...paged(rows, page, perPage), myQueue: store.envelopes.filter((e) => e.status === "SENT") };
  }
  if (path === "/api/workspace/envelope-detail") {
    const id = params.get("id") ?? "";
    const envelope = store.envelopes.find((e) => e.id === id);
    if (!envelope) throw new DemoError("Envelope not found", 404);
    return { envelope, recipients: envelope.recipients, tenantName: envelope.tenantName, events: envelope.events };
  }
  if (path === "/api/workspace/documents") {
    return { rows: store.envelopes.map((e) => ({ id: e.id, title: e.title, pages: e.pages, status: e.status, createdAt: e.createdAt })) };
  }
  if (path === "/api/workspace/templates") {
    let rows = store.templates;
    if (q) rows = rows.filter((t) => matches(t.name, q) || matches(t.category, q));
    const folders = [...new Set(store.templates.map((t) => t.folder))].map((name) => ({
      name,
      count: store.templates.filter((t) => t.folder === name).length,
    }));
    return { rows, folders };
  }
  if (path.startsWith("/api/workspace/settings")) {
    if (method === "POST") return { ok: true, message: "Settings saved." };
    return {
      profile: { firstName: DEMO_USER.firstName, lastName: DEMO_USER.lastName, email: DEMO_USER.email },
      tenant: { name: "Docurama Demo", slug: "demo", planCode: "BUSINESS" },
      signatures: [{ id: "sig-001", name: "Sriram Rajan", kind: "typed", isDefault: true, createdAt: daysAgo(100) }],
      notifications: { envelopeCompleted: true, reminderBeforeExpiry: true, weeklyDigest: false },
      esign: { consentText: null, consentVersion: "v1.0", requireReauth: false, tsaPreset: "none" },
      webhooks: [],
      sms: { provider: "none", configured: false },
      mcp: { enabled: false, keys: [] },
      sessions: [{ id: "sess-demo-001", device: "Chrome on macOS", createdAt: daysAgo(0, 8), current: true }],
    };
  }
  if (path === "/api/workspace/sso") return { sso: null, providers: [] };
  if (path === "/api/auth/sso/lookup") return { sso: null };
  if (path === "/api/workspace/verify" || path.startsWith("/api/v1/verify/")) {
    const code = params.get("code") ?? decodeURIComponent(path.split("/").pop() ?? "");
    const envelope = store.envelopes.find((e) => e.publicCode.toLowerCase() === code.toLowerCase() || e.sha256 === code);
    if (!envelope || !envelope.sha256) throw new DemoError("No attestation found for that code", 404);
    return {
      ok: true,
      attestation: {
        publicCode: envelope.publicCode,
        title: envelope.title,
        sha256: envelope.sha256,
        sealedAt: envelope.sealedAt,
        attestedAt: envelope.attestedAt,
        events: envelope.events,
      },
    };
  }
  if (path === "/api/onboarding") {
    if (method === "POST") return { ok: true };
    return { done: true, steps: [] };
  }

  // ---- Admin ----
  if (path === "/api/admin/overview") {
    return {
      kpis: {
        tenants: store.tenants.length,
        users: store.users.length,
        envelopes: store.envelopes.length,
        sealed: store.envelopes.filter((e) => e.status === "COMPLETED").length,
        mrr: 847,
        activeToday: 2,
        completionRate: 0.82,
        dsarOpen: 1,
        dmcaOpen: 0,
        incidentsOpen: 0,
      },
      stats: Array.from({ length: 14 }, (_, i) => ({ date: daysAgo(13 - i).slice(0, 10), envelopes: (i * 7) % 5, signups: (i * 3) % 2 })),
      planDist: [
        { planCode: "SOLO", _count: 1 },
        { planCode: "STARTER", _count: 1 },
        { planCode: "BUSINESS", _count: 1 },
      ],
      health: {
        certExpiryAt: daysAgo(-180),
        dbOk: true,
        storageOk: true,
        mailOk: true,
        queueDepth: 0,
        signingConformance: "SES",
        sweeperLastRunAt: daysAgo(0, 6),
        tsaReachable: false,
      },
      auditEvents: store.audit,
      securityEvents: store.audit
        .filter((a) => a.severity !== "INFO")
        .map((a) => ({ id: a.id, at: a.at, type: a.action, severity: a.severity, actor: a.actor, ip: a.ip, blocked: a.severity === "CRITICAL", detail: a.detail })),
    };
  }
  if (path === "/api/admin/tenants") {
    let rows = store.tenants;
    if (q) rows = rows.filter((t) => matches(t.name, q) || matches(t.slug, q));
    return paged(rows, page, perPage);
  }
  if (path === "/api/admin/tenant-detail") {
    const tenant = store.tenants.find((t) => t.id === params.get("id"));
    if (!tenant) throw new DemoError("Tenant not found", 404);
    return {
      tenant,
      members: store.users.filter((u) => u.tenantName === tenant.name),
      envelopes: store.envelopes.filter((e) => e.tenantName === tenant.name),
    };
  }
  if (path === "/api/admin/users") {
    let rows = store.users;
    if (q) rows = rows.filter((u) => matches(u.email, q) || matches(u.firstName, q) || matches(u.lastName, q));
    return paged(rows, page, perPage);
  }
  if (path === "/api/admin/envelopes") {
    if (method === "POST") return { ok: true, message: "Envelope updated." };
    let rows = store.envelopes;
    if (status !== "ALL") rows = rows.filter((e) => e.status === status);
    if (q) rows = rows.filter((e) => matches(e.title, q) || matches(e.publicCode, q));
    return paged(rows, page, perPage);
  }
  if (path === "/api/admin/domains") return { rows: store.domains };
  if (path === "/api/admin/legal") {
    return {
      documents: [
        { id: "legal-001", kind: "TERMS", version: "v2.3", publishedAt: daysAgo(90), current: true },
        { id: "legal-002", kind: "PRIVACY", version: "v2.1", publishedAt: daysAgo(90), current: true },
        { id: "legal-003", kind: "DPA", version: "v1.4", publishedAt: daysAgo(60), current: true },
      ],
    };
  }
  if (path === "/api/admin/compliance") {
    return {
      checks: [
        { id: "c-001", area: "eIDAS", status: "PASS", detail: "SES evidence records complete", checkedAt: daysAgo(1) },
        { id: "c-002", area: "GDPR", status: "PASS", detail: "Retention policy applied", checkedAt: daysAgo(1) },
        { id: "c-003", area: "Part 11", status: "REVIEW", detail: "Reauth rollout at 80%", checkedAt: daysAgo(2) },
      ],
    };
  }
  if (path === "/api/admin/billing") {
    return {
      mrr: 847,
      churn: 0.012,
      subscriptions: store.tenants.map((t) => ({ tenant: t.name, plan: t.planCode, status: "ACTIVE", since: t.createdAt })),
      invoices: [
        { id: "inv-2026-09", tenant: "Docurama Demo", amountEur: 49, status: "PAID", issuedAt: daysAgo(30) },
        { id: "inv-2026-10", tenant: "Docurama Demo", amountEur: 49, status: "OPEN", issuedAt: daysAgo(1) },
      ],
    };
  }
  if (path === "/api/admin/leads") {
    let rows = store.leads;
    if (q) rows = rows.filter((l) => matches(l.company, q) || matches(l.email, q));
    const statusFilter = params.get("status") ?? "ALL";
    if (statusFilter !== "ALL") rows = rows.filter((l) => l.status === statusFilter);
    return { rows, total: rows.length };
  }
  if (path === "/api/admin/integrations") {
    return {
      integrations: [
        { id: "int-stripe", name: "Stripe", kind: "Payments", configured: false, detail: "Connect to enable plan billing" },
        { id: "int-smtp", name: "SMTP", kind: "Email", configured: false, detail: "Transactional mail delivery" },
        { id: "int-s3", name: "S3 storage", kind: "Storage", configured: false, detail: "Document object storage" },
        { id: "int-rekor", name: "Rekor witness", kind: "Transparency", configured: false, detail: "Public transparency log witnessing" },
      ],
    };
  }
  if (path === "/api/admin/provisioning") {
    return { modes: [{ id: "self-serve", label: "Self-serve signup", enabled: true }, { id: "enterprise", label: "Enterprise provisioning", enabled: true }], recent: [] };
  }
  if (path === "/api/admin/settings") {
    if (method === "POST") return { ok: true, message: "Platform settings saved." };
    return { publicRegistration: true, maintenanceMode: false, defaultPlan: "SOLO", supportEmail: "support@docurama.eu" };
  }
  if (path === "/api/admin/health") {
    return {
      services: [
        { name: "Database", status: "OK", latencyMs: 4 },
        { name: "Object storage", status: "OK", latencyMs: 11 },
        { name: "Mail outbox", status: "OK", latencyMs: 0 },
        { name: "Transparency log", status: "OK", latencyMs: 7 },
      ],
      version: "1.2.0",
      uptime: "99.98%",
    };
  }
  if (path === "/api/admin/audit") {
    const severity = params.get("severity") ?? "ALL";
    let rows = store.audit;
    if (severity !== "ALL") rows = rows.filter((a) => a.severity === severity);
    if (q) rows = rows.filter((a) => matches(a.action, q) || matches(a.actor ?? "", q) || matches(a.detail, q));
    return {
      ...paged(rows, page, perPage),
      events: rows,
      securityEvents: rows.filter((a) => a.severity !== "INFO"),
      chain: { blockHeight: 1284, sealedAt: daysAgo(0, 6), valid: true },
    };
  }

  // ---- Billing (workspace) ----
  if (path === "/api/billing/overview") {
    return {
      plan: { code: "BUSINESS", name: "Business", monthlyEur: 49 },
      usage: { envelopes: store.envelopes.length, quota: 100 },
      nextInvoiceAt: daysAgo(-30),
      invoices: [{ id: "inv-2026-10", amountEur: 49, status: "OPEN", issuedAt: daysAgo(1) }],
    };
  }
  if (path === "/api/billing/checkout" || path === "/api/billing/portal") {
    throw new DemoError("Billing is not connected in this demo build", 501);
  }

  // ---- Invitations & signing ----
  if (path.startsWith("/api/invitations/")) {
    if (method === "POST") return { ok: true, message: "Invitation accepted. Welcome to the workspace." };
    return {
      invitation: { email: "new.member@example.com", role: "MEMBER", tenantName: "Docurama Demo", inviterName: "Sriram Rajan", expiresAt: daysAgo(-7) },
    };
  }
  if (path.startsWith("/api/sign/")) {
    const token = path.split("/")[3] ?? "";
    const recipientRow = store.envelopes.flatMap((e) => e.recipients.map((r) => ({ r, e }))).find(({ r }) => r.token === token);
    if (!recipientRow) throw new DemoError("This signing link is invalid or has expired", 404);
    const { r, e } = recipientRow;
    if (method === "POST") {
      r.status = "SIGNED";
      r.signedAt = new Date().toISOString();
      e.events.push({ id: `ev-${Date.now()}`, at: new Date().toISOString(), actor: r.email, action: "SIGNED", detail: "Demo signature", ipHash: null });
      if (e.recipients.every((x) => x.status === "SIGNED")) {
        e.status = "COMPLETED";
        e.completedAt = new Date().toISOString();
        e.sealedAt = e.completedAt;
        e.sha256 = sha(e.id);
        e.attestedAt = e.completedAt;
        e.attestStatus = "ATTESTED";
      } else {
        e.status = "PARTIALLY_SIGNED";
      }
      save(store);
      return { ok: true, message: "Document signed. Your evidence copy is on its way." };
    }
    return {
      envelope: {
        title: e.title,
        pages: e.pages,
        senderName: "Sriram Rajan",
        senderOrg: e.tenantName,
        message: `Please review and sign ${e.title}.`,
        expiresAt: daysAgo(-30),
      },
      recipient: { name: r.name, email: r.email, role: r.role, status: r.status },
      consent: {
        schema: 1,
        text: "I agree to sign this document electronically and understand that my typed or drawn signature is legally binding.",
        version: "v1.0",
        digest: sha("consent-v1.0"),
      },
    };
  }

  if (path === "/api/enterprise-lead" && method === "POST") {
    const data = (body ?? {}) as { company?: string; email?: string };
    store.leads.unshift({
      id: `lead-${Date.now()}`,
      company: data.company ?? "Unknown",
      email: data.email ?? "",
      name: (body as { name?: string })?.name ?? "",
      status: "NEW",
      createdAt: new Date().toISOString(),
      message: (body as { message?: string })?.message ?? "",
    });
    save(store);
    return { ok: true, message: "Thanks. The enterprise team will reply within one business day." };
  }

  throw new DemoError(`Not available in the demo build: ${path}`, 404);
}
