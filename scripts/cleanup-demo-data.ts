#!/usr/bin/env bun
/// <reference types="bun-types" />

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth";

const db = new PrismaClient();

async function main() {
  console.log("Starting demo data cleanup and admin setup for sriram.rajan@stalfe.com...");

  // 1. Ensure StålFe tenant exists
  let stalfe = await db.tenant.findUnique({ where: { slug: "stalfe" } });
  if (!stalfe) {
    stalfe = await db.tenant.create({
      data: {
        name: "StålFe",
        slug: "stalfe",
        planCode: "ENTERPRISE",
        status: "ACTIVE",
        storageUsedMb: 0,
        billingEmail: "sriram.rajan@stalfe.com",
      },
    });
    console.log("Created StålFe tenant");
  } else {
    stalfe = await db.tenant.update({
      where: { id: stalfe.id },
      data: {
        billingEmail: "sriram.rajan@stalfe.com",
        status: "ACTIVE",
      },
    });
    console.log("Updated StålFe tenant");
  }

  // 2. Ensure sriram.rajan@stalfe.com exists as PLATFORM_ADMIN & OWNER of stalfe
  const password = "StalFe2026!Admin";
  const passwordHash = hashPassword(password);
  let sriram = await db.user.findUnique({ where: { email: "sriram.rajan@stalfe.com" } });
  if (!sriram) {
    sriram = await db.user.create({
      data: {
        email: "sriram.rajan@stalfe.com",
        firstName: "Sriram",
        lastName: "Rajan",
        role: "PLATFORM_ADMIN",
        status: "ACTIVE",
        passwordHash,
        totpEnabled: false,
        emailVerifiedAt: new Date(),
        activeTenantId: stalfe.id,
      },
    });
    console.log("Created user sriram.rajan@stalfe.com");
  } else {
    sriram = await db.user.update({
      where: { id: sriram.id },
      data: {
        firstName: "Sriram",
        lastName: "Rajan",
        role: "PLATFORM_ADMIN",
        status: "ACTIVE",
        passwordHash,
        totpEnabled: false,
        emailVerifiedAt: new Date(),
        activeTenantId: stalfe.id,
      },
    });
    console.log("Updated user sriram.rajan@stalfe.com");
  }

  // 3. Ensure membership in StålFe
  const existingMember = await db.member.findFirst({
    where: { userId: sriram.id, tenantId: stalfe.id },
  });
  if (!existingMember) {
    await db.member.create({
      data: {
        userId: sriram.id,
        tenantId: stalfe.id,
        role: "OWNER",
      },
    });
    console.log("Added sriram.rajan@stalfe.com as OWNER of StålFe");
  } else {
    await db.member.update({
      where: { id: existingMember.id },
      data: { role: "OWNER" },
    });
    console.log("Updated sriram.rajan@stalfe.com to OWNER of StålFe");
  }

  // 4. Ensure verified domain stalfe.com is linked to StålFe
  const domain = await db.domain.findFirst({
    where: { tenantId: stalfe.id, domain: "stalfe.com" },
  });
  if (!domain) {
    await db.domain.create({
      data: {
        tenantId: stalfe.id,
        domain: "stalfe.com",
        method: "TXT",
        status: "VERIFIED",
        token: "docu-verify-stalfe-corp",
        verifiedAt: new Date(),
      },
    });
    console.log("Added verified domain stalfe.com");
  } else {
    await db.domain.update({
      where: { id: domain.id },
      data: { status: "VERIFIED", verifiedAt: new Date() },
    });
    console.log("Updated verified domain stalfe.com");
  }

  // 5. Remove fake client emails and demo data
  // Delete fake leads
  const deletedLeads = await db.enterpriseLead.deleteMany({
    where: {
      OR: [
        { email: { contains: ".example" } },
        { company: { in: ["Nordpharm Medical Devices", "Banque Helvetia Partenaires", "Voltalis Grid Services"] } },
      ],
    },
  });
  console.log(`Deleted ${deletedLeads.count} fake enterprise leads`);

  // Delete fake DSAR requests
  const deletedDsar = await db.dsarRequest.deleteMany({
    where: { subjectEmail: { contains: ".example" } },
  });
  console.log(`Deleted ${deletedDsar.count} fake DSAR requests`);

  // Delete fake DMCA notices
  const deletedDmca = await db.dmcaNotice.deleteMany({
    where: { complainant: { contains: ".example" } },
  });
  console.log(`Deleted ${deletedDmca.count} fake DMCA notices`);

  // Delete fake mail outbox items
  const deletedOutbox = await db.mailOutbox.deleteMany({
    where: {
      OR: [
        { toEmail: { contains: ".example" } },
        { toEmail: { contains: "e2e-" } },
      ],
    },
  });
  console.log(`Deleted ${deletedOutbox.count} fake/test outbox emails`);

  // Delete demo envelopes and recipients with fake client emails
  const demoRecipients = await db.recipient.findMany({
    where: { email: { contains: ".example" } },
    select: { envelopeId: true },
  });
  const demoEnvelopeIds = [...new Set(demoRecipients.map((r) => r.envelopeId))];

  if (demoEnvelopeIds.length > 0) {
    await db.envelopeEvent.deleteMany({ where: { envelopeId: { in: demoEnvelopeIds } } });
    await db.recipient.deleteMany({ where: { envelopeId: { in: demoEnvelopeIds } } });
    const deletedEnvs = await db.envelope.deleteMany({ where: { id: { in: demoEnvelopeIds } } });
    console.log(`Deleted ${deletedEnvs.count} demo envelopes with fake client signers`);
  }

  // Delete demo users ending with .example and test remnants
  const demoUsers = await db.user.findMany({
    where: {
      OR: [
        { email: { contains: ".example" } },
        { email: { startsWith: "e2e-solo-" } },
        { email: { startsWith: "e2e-starter-" } },
      ],
    },
    select: { id: true, email: true },
  });

  const demoUserIds = demoUsers.map((u) => u.id);
  if (demoUserIds.length > 0) {
    await db.session.deleteMany({ where: { userId: { in: demoUserIds } } });
    await db.member.deleteMany({ where: { userId: { in: demoUserIds } } });
    await db.userSignature.deleteMany({ where: { userId: { in: demoUserIds } } });
    await db.authChallenge.deleteMany({ where: { userId: { in: demoUserIds } } });
    await db.emailVerification.deleteMany({ where: { userId: { in: demoUserIds } } });
    const deletedUsers = await db.user.deleteMany({ where: { id: { in: demoUserIds } } });
    console.log(`Deleted ${deletedUsers.count} demo users (${demoUsers.map((u) => u.email).join(", ")})`);
  }

  // Delete demo tenants that are not StålFe or e2e-testing
  const demoTenants = await db.tenant.findMany({
    where: {
      slug: {
        in: [
          "aurora-legal", "helios-energy", "bayern-immo", "meteora-health",
          "solstice-media", "corvus-mfg", "lumen-research", "atlas-freight",
          "verdant-agri", "lefebvre-consulting",
        ],
      },
    },
    select: { id: true, slug: true },
  });

  for (const t of demoTenants) {
    // Delete tenant relations
    await db.domain.deleteMany({ where: { tenantId: t.id } });
    await db.subscription.deleteMany({ where: { tenantId: t.id } });
    await db.template.deleteMany({ where: { tenantId: t.id } });
    await db.team.deleteMany({ where: { tenantId: t.id } });
    await db.webhookEndpoint.deleteMany({ where: { tenantId: t.id } });
    await db.member.deleteMany({ where: { tenantId: t.id } });
    const envs = await db.envelope.findMany({ where: { tenantId: t.id }, select: { id: true } });
    const eIds = envs.map((e) => e.id);
    if (eIds.length > 0) {
      await db.envelopeEvent.deleteMany({ where: { envelopeId: { in: eIds } } });
      await db.recipient.deleteMany({ where: { envelopeId: { in: eIds } } });
      await db.envelope.deleteMany({ where: { id: { in: eIds } } });
    }
    await db.tenant.delete({ where: { id: t.id } });
    console.log(`Deleted demo tenant: ${t.slug}`);
  }

  // Delete stray e2e-* workshop tenants
  const e2eWorkshops = await db.tenant.findMany({
    where: { slug: { startsWith: "e2e-solo-workshop" } },
    select: { id: true, slug: true },
  });
  for (const t of e2eWorkshops) {
    await db.subscription.deleteMany({ where: { tenantId: t.id } });
    await db.member.deleteMany({ where: { tenantId: t.id } });
    await db.tenant.delete({ where: { id: t.id } });
  }

  const e2eStarterWorkshops = await db.tenant.findMany({
    where: { slug: { startsWith: "e2e-starter-workshop" } },
    select: { id: true, slug: true },
  });
  for (const t of e2eStarterWorkshops) {
    await db.subscription.deleteMany({ where: { tenantId: t.id } });
    await db.member.deleteMany({ where: { tenantId: t.id } });
    await db.tenant.delete({ where: { id: t.id } });
  }

  console.log("Cleanup complete!");
}

main().catch(console.error).finally(() => db.$disconnect());
