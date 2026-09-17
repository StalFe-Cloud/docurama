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
 */

import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

const E2E_SIGNER_TOKEN = "e2e-fixed-signer-token-0000000000000001";
const E2E_DECLINE_TOKEN = "e2e-fixed-decline-token-0000000000000001";
const E2E_JOURNEY_TOKEN = "e2e-fixed-journey-token-0000000000000001";
const E2E_API_KEY_SECRET = "dk_e2e_0000000000000000000000000000000000000000";

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
