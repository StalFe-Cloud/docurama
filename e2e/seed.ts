/**
 * E2E seed — deterministic, idempotent fixtures for the Maestro suite.
 *
 * Run: bun e2e/seed.ts   (or `bun run test:e2e:seed`)
 *
 * Design rules:
 *  - All E2E writes are confined to the dedicated "E2E Testing" tenant.
 *    The demo dataset (StålFe, Aurora, …) is never touched.
 *  - Re-running wipes the tenant's envelopes/templates first, so every
 *    `maestro test` cycle starts from the same state.
 *  - Passwords use the same sha256 scheme as src/lib/auth.ts (hashPassword).
 *  - Fixed publicCodes (DOC-E2E0001/0002/0003) make verify-portal flows
 *    deterministic without scraping codes out of the UI.
 *  - Fixed signing tokens (E2E_SIGNER_TOKEN / E2E_DECLINE_TOKEN) make the
 *    signer-portal flows deterministic — in production tokens are 32 random
 *    bytes, the seed pins two so Maestro can open /sign/{token} directly.
 *  - An API key fixture (known secret, ENVELOPES scope) drives the API-layer
 *    test suite (e2e/api.test.ts).
 *  - A real uploaded PDF (spec-correct bytes written through document-store)
 *    on DOC-E2E0001 drives the signer-portal PDF embed + its GET endpoint.
 *  - MCP fixtures: an enabled config on the main tenant (all tools) and a
 *    strict tenant (allowlist of one tool, 3 req/min) for e2e/mcp.test.ts.
 *  - A spent-quota tenant (SMART_TEAM, limit override 1, 1 envelope in the
 *    window) for the 402 regression test in e2e/quota.test.ts.
 */

import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  commitmentHash, chainEntryHash, appendPortalLogEntry,
  GENESIS_HEAD, TRANSPARENCY_FORMAT,
} from "../src/lib/transparency";
import { storeUpload } from "../src/lib/document-store";

const run = promisify(execFile);

const E2E_SIGNER_TOKEN = "e2e-fixed-signer-token-0000000000000001";
const E2E_DECLINE_TOKEN = "e2e-fixed-decline-token-0000000000000001";
const E2E_JOURNEY_TOKEN = "e2e-fixed-journey-token-0000000000000001";
const E2E_API_KEY_SECRET = "dk_e2e_0000000000000000000000000000000000000000";
const E2E_CC_TOKEN = "e2e-fixed-cc-token-000000000000000000001";
const E2E_VOIDED_TOKEN = "e2e-fixed-voided-token-0000000000000001";
const E2E_MCP_STRICT_KEY_SECRET = "dk_e2e_mcp_strict_00000000000000000001";
const E2E_MCP_RATE_KEY_SECRET = "dk_e2e_mcp_rate_000000000000000000000001";
const E2E_QUOTA_KEY_SECRET = "dk_e2e_quota_000000000000000000000000000001";
const E2E_QUOTA_USER_EMAIL = "e2e-quota@docurama.eu";
const E2E_QUOTA_USER_PASSWORD = "e2eQuota1234!";

/** Minimal, spec-correct one-page PDF with a real xref table. The
 *  signer-portal embed renders these bytes in a real browser and the API
 *  tests hash them — so the fixture must be a valid PDF, not a stub. */
function buildOnePagePdf(text: string): Buffer {
  const esc = text.replace(/([()\\])/g, "\\$1");
  const stream = `BT /F1 18 Tf 72 770 Td (${esc}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// Fixtures for the attested-verification flow (public portal result for a
// code sealed on a "remote self-hosted instance" — seeded directly as if the
// receiver had processed the push).
const E2E_ATTESTED_CODE = "DOC-E2EATST";
const E2E_ATTESTED_DOMAIN = "acme-corp.example";

const db = new PrismaClient();

const hashPassword = (pw: string) => createHash("sha256").update(pw).digest("hex");

const E2E_TENANT_SLUG = "e2e-testing";
const E2E_USER_EMAIL = "e2e@docurama.eu";
const E2E_USER_PASSWORD = "e2ePass1234!";
const E2E_ADMIN_EMAIL = "e2e-admin@docurama.eu";
const E2E_ADMIN_PASSWORD = "e2eAdmin1234!";

async function main() {
  /* ── Tenant ──────────────────────────────────────────────────────── */
  const tenant =
    (await db.tenant.findUnique({ where: { slug: E2E_TENANT_SLUG } })) ??
    (await db.tenant.create({
      data: {
        name: "E2E Testing",
        slug: E2E_TENANT_SLUG,
        planCode: "ENTERPRISE", // high monthly quota so flows never hit 402
        status: "ACTIVE",
      },
    }));
  console.log(`tenant: ${tenant.name} (${tenant.id})`);

  /* ── Wipe prior E2E run artifacts (envelopes cascade to recipients/events) ── */
  const wiped = await db.envelope.deleteMany({ where: { tenantId: tenant.id } });
  await db.template.deleteMany({ where: { tenantId: tenant.id } });
  // Uploaded-PDF fixtures: rows go, and the (small) bytes with them on the
  // next storeUpload — document-store keys by docId so stale files are
  // simply orphaned until then; QA-only, never production behaviour.
  await db.document.deleteMany({ where: { tenantId: tenant.id } });
  console.log(`wiped ${wiped.count} prior E2E envelope(s)`);

  /* ── Users ───────────────────────────────────────────────────────── */
  const upsertUser = async (
    email: string,
    password: string,
    role: string,
    extra: { firstName: string; lastName: string }
  ) => {
    const existing = await db.user.findUnique({ where: { email } });
    const data = {
      email,
      passwordHash: hashPassword(password),
      firstName: extra.firstName,
      lastName: extra.lastName,
      role,
      status: "ACTIVE",
    };
    const user = existing
      ? await db.user.update({ where: { id: existing.id }, data })
      : await db.user.create({ data });
    // Membership in the E2E tenant (OWNER for the workspace user, ADMIN seat
    // for the platform admin so they can scope into it if a flow needs to).
    const member =
      (await db.member.findFirst({ where: { userId: user.id, tenantId: tenant.id } })) ??
      (await db.member.create({
        data: { userId: user.id, tenantId: tenant.id, role: role === "PLATFORM_ADMIN" ? "ADMIN" : "OWNER" },
      }));
    // activeTenantId scopes the workspace API for this user.
    const scoped =
      role === "PLATFORM_ADMIN"
        ? { activeTenantId: null } // platform admins see the admin console by default
        : { activeTenantId: tenant.id };
    if (existing) {
      await db.user.update({ where: { id: user.id }, data: scoped });
    } else {
      await db.user.update({ where: { id: user.id }, data: scoped });
    }
    void member;
    return user;
  };

  const wsUser = await upsertUser(E2E_USER_EMAIL, E2E_USER_PASSWORD, "WORKSPACE_ADMIN", {
    firstName: "Ella",
    lastName: "Tester",
  });
  await upsertUser(E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, "PLATFORM_ADMIN", {
    firstName: "Adam",
    lastName: "Admin",
  });
  console.log(`users: ${E2E_USER_EMAIL} (tenant scoped), ${E2E_ADMIN_EMAIL} (platform admin)`);

  /* ── Fixture envelopes (deterministic verify-portal targets) ─────── */
  // SENT, one pending recipient — verify portal must report NOT_SEALED.
  // Carries the real uploaded PDF (linked below) and a CC recipient, so the
  // document GET tests cover all three access shapes: signer 200 / CC 403 /
  // no-PDF 404 on other fixtures.
  await db.envelope.create({
    data: {
      publicCode: "DOC-E2E0001",
      title: "E2E Fixture — Mutual NDA (sent)",
      titleLower: "e2e fixture — mutual nda (sent)",
      tenantId: tenant.id,
      createdById: wsUser.id,
      status: "SENT",
      message: "Fixture envelope seeded for the verify-portal flow.",
      pages: 3,
      recipients: {
        create: [
          {
            name: "Fixture Signer",
            email: "fixture-signer@example.com",
            role: "SIGNER",
            order: 1,
            status: "PENDING",
            accessToken: E2E_SIGNER_TOKEN,
          },
          {
            name: "Fixture CC",
            email: "fixture-cc@example.com",
            role: "CC",
            order: 2,
            status: "PENDING",
            accessToken: E2E_CC_TOKEN,
          },
        ],
      },
      events: {
        create: [
          { actor: "Ella Tester", action: "CREATED", detail: "Seeded fixture" },
          { actor: "Docurama", action: "SENT", detail: "Seeded fixture" },
        ],
      },
    },
  });

  // SENT, one pending recipient — the decline flow (see below) needs its own
  // envelope so signing/declining never disturbs the other flows' fixtures.
  await db.envelope.create({
    data: {
      publicCode: "DOC-E2E0003",
      title: "E2E Fixture — Consultant Agreement (decline)",
      titleLower: "e2e fixture — consultant agreement (decline)",
      tenantId: tenant.id,
      createdById: wsUser.id,
      status: "SENT",
      message: "Fixture envelope seeded for the decline flow.",
      pages: 2,
      recipients: {
        create: [
          {
            name: "Fixture Decliner",
            email: "fixture-decliner@example.com",
            role: "SIGNER",
            order: 1,
            status: "PENDING",
            accessToken: E2E_DECLINE_TOKEN,
          },
        ],
      },
      events: {
        create: [
          { actor: "Ella Tester", action: "CREATED", detail: "Seeded fixture" },
          { actor: "Docurama", action: "SENT", detail: "Seeded fixture" },
        ],
      },
    },
  });

  // COMPLETED + sealed — verify portal must report VERIFIED with digest.
  const sealedDigest = createHash("sha256")
    .update("docurama-e2e-sealed-fixture")
    .digest("hex");
  await db.envelope.create({
    data: {
      publicCode: "DOC-E2E0002",
      title: "E2E Fixture — Supply Agreement (sealed)",
      titleLower: "e2e fixture — supply agreement (sealed)",
      tenantId: tenant.id,
      createdById: wsUser.id,
      status: "COMPLETED",
      message: "Seeded sealed fixture.",
      pages: 5,
      sha256: sealedDigest,
      sealedAt: new Date(),
      completedAt: new Date(),
      conformanceLevel: "B-LT",
      recipients: {
        create: [
          {
            name: "Fixture Signer",
            email: "fixture-signer@example.com",
            role: "SIGNER",
            order: 1,
            status: "SIGNED",
            signedAt: new Date(),
            accessToken: randomBytes(32).toString("base64url"),
          },
        ],
      },
      events: {
        create: [
          { actor: "Ella Tester", action: "CREATED", detail: "Seeded fixture" },
          { actor: "Fixture Signer", action: "SIGNED", detail: "Sealed fixture signature" },
          { actor: "Docurama", action: "SEALED", detail: "All signers completed. Seeded fixture seal (verification code DOC-E2E0002)" },
        ],
      },
    },
  });

  // SENT, one pending recipient — the signer-portal happy path: the flow opens
  // the link, adopts a signature, signs, and the envelope seals (COMPLETED).
  // Its own fixture so sealing never breaks the NOT_SEALED assertions on 0001.
  await db.envelope.create({
    data: {
      publicCode: "DOC-E2E0004",
      title: "E2E Fixture — Service Agreement (signer journey)",
      titleLower: "e2e fixture — service agreement (signer journey)",
      tenantId: tenant.id,
      createdById: wsUser.id,
      status: "SENT",
      message: "Please review and sign at your convenience.",
      pages: 4,
      recipients: {
        create: [
          {
            name: "Fixture Journey",
            email: "fixture-journey@example.com",
            role: "SIGNER",
            order: 1,
            status: "PENDING",
            accessToken: E2E_JOURNEY_TOKEN,
          },
        ],
      },
      events: {
        create: [
          { actor: "Ella Tester", action: "CREATED", detail: "Seeded fixture" },
          { actor: "Docurama", action: "SENT", detail: "Seeded fixture" },
        ],
      },
    },
  });

  console.log("fixtures: DOC-E2E0001 (SENT) + DOC-E2E0002 (COMPLETED/sealed) + DOC-E2E0003 (SENT/decline) + DOC-E2E0004 (SENT/signer-journey)");

  /* ── API key fixture (e2e/api.test.ts) ───────────────────────── */
  const secretHash = createHash("sha256").update(E2E_API_KEY_SECRET).digest("hex");
  await db.apiKey.deleteMany({ where: { name: "E2E Suite Key" } });
  await db.apiKey.create({
    data: {
      tenantId: tenant.id,
      name: "E2E Suite Key",
      prefix: "dk_e2e_",
      secretHash,
      scope: "ENVELOPES",
      status: "ACTIVE",
      createdBy: wsUser.id,
    },
  });
  console.log("api key: E2E Suite Key (ENVELOPES scope) for the API-layer tests");

  /* ── Uploaded-PDF fixture (signer-portal embed + GET /api/sign/{t}/document) ── */
  // Real bytes through the real store: storeUpload enforces the PDF magic
  // check and computes the digest, so the fixture exercises the same path a
  // workspace upload takes. Two envelopes reference it: the SENT fixture
  // (signer may review) and a VOIDED fixture (terminal — review blocked).
  {
    const pdfBytes = buildOnePagePdf("E2E Fixture - Mutual NDA. Signer-portal PDF embed fixture.");
    const stored = await storeUpload(
      (async function* () { yield pdfBytes; })(),
      tenant.id,
    );
    const doc = await db.document.create({
      data: {
        id: stored.docId,
        tenantId: tenant.id,
        uploadedById: wsUser.id,
        filename: "e2e-mutual-nda.pdf",
        storageKey: stored.storageKey,
        byteSize: stored.byteSize,
        mimeType: "application/pdf",
        pageCount: 1,
        sha256: stored.sha256,
        hasTextLayer: true,
      },
    });
    await db.envelope.update({
      where: { publicCode: "DOC-E2E0001" },
      data: { documentId: doc.id, pages: 1 },
    });

    // VOIDED + document: the GET endpoint must refuse review on terminal
    // envelopes even though the bytes exist and the token is valid.
    await db.envelope.create({
      data: {
        publicCode: "DOC-E2E0005",
        title: "E2E Fixture — Voided Lease (PDF, review blocked)",
        titleLower: "e2e fixture — voided lease (pdf, review blocked)",
        tenantId: tenant.id,
        createdById: wsUser.id,
        status: "VOIDED",
        message: "Fixture envelope seeded for the terminal-state document test.",
        pages: 1,
        documentId: doc.id,
        voidedAt: new Date(),
        voidReason: "E2E fixture: superseded by a newer draft",
        recipients: {
          create: [
            {
              name: "Fixture Voided",
              email: "fixture-voided@example.com",
              role: "SIGNER",
              order: 1,
              status: "PENDING",
              accessToken: E2E_VOIDED_TOKEN,
            },
          ],
        },
        events: {
          create: [
            { actor: "Ella Tester", action: "CREATED", detail: "Seeded fixture" },
            { actor: "Ella Tester", action: "VOIDED", detail: "E2E fixture: superseded by a newer draft" },
          ],
        },
      },
    });
    console.log(`pdf fixture: DOC-E2E0001 + DOC-E2E0005 share doc ${doc.id} (sha256 ${doc.sha256.slice(0, 12)}…)`);
  }

  /* ── MCP fixtures (e2e/mcp.test.ts) ─────────────────────────────── */
  // Main tenant: everything enabled, generous rate limit — the suite key
  // doubles as the MCP key (the route accepts any ACTIVE workspace key).
  await db.mcpConfig.upsert({
    where: { tenantId: tenant.id },
    update: { enabled: true, allowedTools: "envelope_list,envelope_detail,document_verify,template_list", rateLimitPerMin: 120 },
    create: {
      tenantId: tenant.id, enabled: true, transport: "streamable-http",
      allowedTools: "envelope_list,envelope_detail,document_verify,template_list",
      rateLimitPerMin: 120,
    },
  });

  // Strict tenant: allowlist of exactly one real tool (plus a stale name so
  // the unknown-tool path is covered) and a low rate limit. Two keys share
  // the config: the functional key for allowlist tests, a dedicated rate key
  // whose bucket may be freely exhausted — an in-memory bucket that survived
  // a previous run must never break the functional assertions.
  {
    await db.tenant.deleteMany({ where: { slug: "e2e-mcp" } });
    const mcpTenant = await db.tenant.create({
      data: { name: "E2E MCP Ltd", slug: "e2e-mcp", planCode: "SMART_TEAM", status: "ACTIVE" },
    });
    const owner =
      (await db.user.findUnique({ where: { email: "e2e-mcp@docurama.eu" } })) ??
      (await db.user.create({
        data: {
          email: "e2e-mcp@docurama.eu", passwordHash: hashPassword("e2eMcp1234!"),
          firstName: "Mia", lastName: "McPhee", role: "WORKSPACE_ADMIN", status: "ACTIVE",
        },
      }));
    await db.member.create({ data: { userId: owner.id, tenantId: mcpTenant.id, role: "OWNER" } });
    await db.mcpConfig.create({
      data: {
        tenantId: mcpTenant.id, enabled: true, transport: "streamable-http",
        allowedTools: "envelope_list,teleport", rateLimitPerMin: 10,
      },
    });
    await db.apiKey.createMany({
      data: [
        {
          tenantId: mcpTenant.id, name: "E2E MCP Strict Key", prefix: "dk_e2e_mcp_",
          secretHash: createHash("sha256").update(E2E_MCP_STRICT_KEY_SECRET).digest("hex"),
          scope: "READONLY", status: "ACTIVE", createdBy: owner.id,
        },
        {
          tenantId: mcpTenant.id, name: "E2E MCP Rate Key", prefix: "dk_e2e_mcp_",
          secretHash: createHash("sha256").update(E2E_MCP_RATE_KEY_SECRET).digest("hex"),
          scope: "READONLY", status: "ACTIVE", createdBy: owner.id,
        },
      ],
    });
    console.log("mcp fixtures: main tenant all-tools/120rpm + strict tenant e2e-mcp (envelope_list only, 10rpm, 2 keys)");
  }

  /* ── Spent-quota tenant (e2e/quota.test.ts) ─────────────────────── */
  // SMART_TEAM with a negotiated limit of exactly ONE envelope and one
  // envelope already sent in the current window: allowance is exhausted, so
  // workspace send must answer 402 with the honest upgrade copy while API
  // reads (v1) stay 200 — quota never blocks reads.
  {
    await db.tenant.deleteMany({ where: { slug: "e2e-quota" } });
    const quotaTenant = await db.tenant.create({
      data: { name: "E2E Quota Ltd", slug: "e2e-quota", planCode: "SMART_TEAM", status: "ACTIVE" },
    });
    const existing = await db.user.findUnique({ where: { email: E2E_QUOTA_USER_EMAIL } });
    const quotaUser = existing
      ? await db.user.update({
          where: { id: existing.id },
          data: { activeTenantId: quotaTenant.id, status: "ACTIVE" },
        })
      : await db.user.create({
          data: {
            email: E2E_QUOTA_USER_EMAIL, passwordHash: hashPassword(E2E_QUOTA_USER_PASSWORD),
            firstName: "Quinn", lastName: "Quota", role: "WORKSPACE_ADMIN", status: "ACTIVE",
            activeTenantId: quotaTenant.id,
          },
        });
    await db.member.create({ data: { userId: quotaUser.id, tenantId: quotaTenant.id, role: "OWNER" } });
    await db.subscription.create({
      data: {
        tenantId: quotaTenant.id, planCode: "SMART_TEAM", status: "ACTIVE",
        mrrEur: 79, seats: 1, renewalAt: new Date(Date.now() + 30 * 86400000),
        billingMonths: 1, discountPct: 0, periodStartedAt: new Date(Date.now() - 3600_000),
        envelopeLimitOverride: 1,
      },
    });
    // The one spent envelope (created inside the current window).
    await db.envelope.create({
      data: {
        publicCode: "DOC-E2EQTA1",
        title: "E2E Quota — the one envelope the plan allowed",
        titleLower: "e2e quota — the one envelope the plan allowed",
        tenantId: quotaTenant.id,
        createdById: quotaUser.id,
        status: "SENT",
        pages: 1,
        recipients: {
          create: [
            {
              name: "Quota Spent", email: "quota-spent@example.com", role: "SIGNER",
              order: 1, status: "PENDING", accessToken: randomBytes(32).toString("base64url"),
            },
          ],
        },
        events: { create: [{ actor: "Quinn Quota", action: "CREATED", detail: "Seeded fixture" }] },
      },
    });
    await db.apiKey.create({
      data: {
        tenantId: quotaTenant.id, name: "E2E Quota Key", prefix: "dk_e2e_quota_",
        secretHash: createHash("sha256").update(E2E_QUOTA_KEY_SECRET).digest("hex"),
        scope: "ENVELOPES", status: "ACTIVE", createdBy: quotaUser.id,
      },
    });
    console.log(`quota fixture: tenant e2e-quota spent (limit 1, used 1) — login ${E2E_QUOTA_USER_EMAIL}`);
  }

  /* ── Attested-verification fixture (remote "self-hosted instance") ── */
  // Simulates what the portal receiver stores after a real self-hosted push:
  // a TOFU-registered instance key + the minimal fingerprint for DOC-E2EATST.
  // The key pair and the signature are REAL (openssl RSA-2048 + SHA-256), so
  // the fixture is byte-equivalent to a production attestation.
  {
    // In the E2E environment this app plays BOTH roles (instance + portal), so
    // the api/evidence tests leave TOFU-registered loopback instances behind.
    // A fresh sweep keeps the portal tables deterministic; the Acme fixture
    // below is recreated immediately after.
    await db.portalAttestation.deleteMany({});
    await db.portalInstance.deleteMany({});
    // The portal's own append-only log is swept with the rest so every seed
    // cycle restarts the chain deterministically (dev/E2E posture — a real
    // portal never deletes log entries).
    await db.portalLogEntry.deleteMany({});

    await db.portalAttestation.deleteMany({ where: { code: E2E_ATTESTED_CODE } });

    const dir = await mkdtemp(join(tmpdir(), "docurama-seed-attest-"));
    try {
      const keyPath = join(dir, "key.pem");
      const certPath = join(dir, "cert.pem");
      await run("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "730", "-nodes",
        "-keyout", keyPath, "-out", certPath,
        "-subj", "/CN=Docurama Evidence Key - Acme Corp/O=Acme Corp/C=FR",
        "-addext", `subjectAltName=DNS:${E2E_ATTESTED_DOMAIN}`,
      ]);
      const pub = await run("openssl", ["x509", "-in", certPath, "-pubkey", "-noout"]);
      const [privateKeyPem, certificatePem] = await Promise.all([
        readFile(keyPath, "utf8"),
        readFile(certPath, "utf8"),
      ]);
      const thumbprint = createHash("sha256")
        .update(Buffer.from(certificatePem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, ""), "base64"))
        .digest("hex");

      const sealedAt = new Date();
      const attestedDigest = createHash("sha256").update("docurama-e2e-attested-fixture").digest("hex");

      // The transparency claim a real instance at chain position 1 would push:
      // the entry commits to the exact fingerprint above and hashes consistently
      // (seq 1, genesis prevHead) — byte-equivalent to a production push.
      const tPayloadHash = commitmentHash({
        code: E2E_ATTESTED_CODE, sha256: attestedDigest, sealedAt: sealedAt.toISOString(),
        conformance: "B-T", pages: 4, signerCount: 2,
      });
      const tEntryHash = chainEntryHash({
        seq: 1, payloadHash: tPayloadHash, prevHead: GENESIS_HEAD, at: sealedAt.toISOString(),
      });

      const rawPayload = JSON.stringify({
        format: "docurama-attestation", version: 1,
        instance: { keyId: "ek_fixture_acme", label: "Acme Corp (self-hosted fixture)", verifiedDomain: E2E_ATTESTED_DOMAIN },
        envelope: {
          code: E2E_ATTESTED_CODE, sha256: attestedDigest,
          sealedAt: sealedAt.toISOString(), completedAt: sealedAt.toISOString(),
          conformance: "B-T", pages: 4, signerCount: 2,
        },
        publicKeyPem: pub.stdout.trim(), certificatePem: certificatePem.trim(), keyThumbprint: thumbprint,
        transparency: {
          format: TRANSPARENCY_FORMAT, seq: 1,
          payloadHash: tPayloadHash, prevHead: GENESIS_HEAD, entryHash: tEntryHash, at: sealedAt.toISOString(),
        },
      });

      const instance = await db.portalInstance.create({
        data: {
          keyThumbprint: thumbprint,
          label: "Acme Corp (self-hosted fixture)",
          verifiedDomain: E2E_ATTESTED_DOMAIN,
          certificatePem: certificatePem.trim(),
          publicKeyPem: pub.stdout.trim(),
          attestationCount: 1,
        },
      });
      await db.portalAttestation.create({
        data: {
          code: E2E_ATTESTED_CODE,
          sha256: attestedDigest,
          sealedAt,
          completedAt: sealedAt,
          conformance: "B-T",
          pages: 4,
          signerCount: 2,
          verifiedDomain: E2E_ATTESTED_DOMAIN,
          instanceThumbprint: instance.keyThumbprint,
          rawPayload,
          tSeq: 1,
          tEntryHash: tEntryHash,
        },
      });
      // Witness the fixture in the portal's own append-only log, exactly like
      // the receiver does for a live push — so /api/transparency/proof/DOC-E2EATST
      // serves a real, verifiable inclusion proof for the seeded code.
      const witnessed = await appendPortalLogEntry({
        code: E2E_ATTESTED_CODE,
        instanceThumbprint: instance.keyThumbprint,
        sha256: attestedDigest,
        instanceEntryHash: tEntryHash,
      });
      console.log(`attested fixture: ${E2E_ATTESTED_CODE} (instance "Acme Corp (self-hosted fixture)", domain ${E2E_ATTESTED_DOMAIN}, portal log entry #${witnessed.seq})`);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /* ── Summary ─────────────────────────────────────────────────────── */
  const envelopes = await db.envelope.count({ where: { tenantId: tenant.id } });
  console.log(`\nSeed OK — tenant ${tenant.slug} now holds ${envelopes} envelope(s).`);
  console.log(`E2E workspace login: ${E2E_USER_EMAIL} / ${E2E_USER_PASSWORD}`);
  console.log(`E2E admin login:     ${E2E_ADMIN_EMAIL} / ${E2E_ADMIN_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
