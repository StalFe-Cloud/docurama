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

  // 2. Ensure admin@docurama.eu exists as PLATFORM_ADMIN & OWNER of stalfe
  const password = "StalFe2026!Admin";
  const passwordHash = hashPassword(password);
  let admin = await db.user.findUnique({ where: { email: "admin@docurama.eu" } });
  if (!admin) {
    admin = await db.user.create({
      data: {
        email: "admin@docurama.eu",
        firstName: "Docurama",
        lastName: "Admin",
        role: "PLATFORM_ADMIN",
        status: "ACTIVE",
        passwordHash,
        totpEnabled: false,
        emailVerifiedAt: new Date(),
        activeTenantId: stalfe.id,
      },
    });
    console.log("Created user admin@docurama.eu");
  } else {
    admin = await db.user.update({
      where: { id: admin.id },
      data: {
        firstName: "Docurama",
        lastName: "Admin",
        role: "PLATFORM_ADMIN",
        status: "ACTIVE",
        passwordHash,
        totpEnabled: false,
        emailVerifiedAt: new Date(),
        activeTenantId: stalfe.id,
      },
    });
    console.log("Updated user admin@docurama.eu");
  }

  // 3. Ensure membership in StålFe
  const existingMember = await db.member.findFirst({
    where: { userId: admin.id, tenantId: stalfe.id },
  });
  if (!existingMember) {
    await db.member.create({
      data: {
        userId: admin.id,
        tenantId: stalfe.id,
        role: "OWNER",
      },
    });
    console.log("Added admin@docurama.eu as OWNER of StålFe");
  } else {
    await db.member.update({
      where: { id: existingMember.id },
      data: { role: "OWNER" },
    });
    console.log("Updated admin@docurama.eu to OWNER of StålFe");
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
        { email: { contains: "@example.com" } },
        { company: { in: ["Nordpharm Medical Devices", "Banque Helvetia Partenaires", "Voltalis Grid Services"] } },
      ],
    },
  });
  console.log(`Deleted ${deletedLeads.count} fake enterprise leads`);

  // Delete fake DSAR requests
  const deletedDsar = await db.dsarRequest.deleteMany({
    where: {
      OR: [
        { subjectEmail: { contains: ".example" } },
        { subjectEmail: { contains: "@example.com" } },
      ],
    },
  });
  console.log(`Deleted ${deletedDsar.count} fake DSAR requests`);

  // Delete fake DMCA notices
  const deletedDmca = await db.dmcaNotice.deleteMany({
    where: {
      OR: [
        { complainant: { contains: ".example" } },
        { complainant: { contains: "@example.com" } },
      ],
    },
  });
  console.log(`Deleted ${deletedDmca.count} fake DMCA notices`);

  // Delete fake mail outbox items
  const deletedOutbox = await db.mailOutbox.deleteMany({
    where: {
      OR: [
        { toEmail: { contains: ".example" } },
        { toEmail: { contains: "@example.com" } },
        { toEmail: { contains: "e2e-" } },
      ],
    },
  });
  console.log(`Deleted ${deletedOutbox.count} fake/test outbox emails`);

  // Identify demo users to delete
  const demoUsers = await db.user.findMany({
    where: {
      AND: [
        { email: { notIn: ["admin@docurama.eu", "sriram.rajan@stalfe.com"] } },
        {
          OR: [
            { email: { contains: ".example" } },
            { email: { contains: "@example.com" } },
            { email: { in: ["ops@docurama.eu"] } },
            { email: { startsWith: "e2e-solo-" } },
            { email: { startsWith: "e2e-starter-" } },
          ],
        },
      ],
    },
    select: { id: true, email: true },
  });

  const demoUserIds = demoUsers.map((u) => u.id);

  // Delete demo envelopes and recipients with fake client emails or created by demo users
  const demoRecipients = await db.recipient.findMany({
    where: {
      OR: [
        { email: { contains: ".example" } },
        { email: { contains: "@example.com" } },
      ],
    },
    select: { envelopeId: true },
  });
  const demoCreatedEnvelopes = await db.envelope.findMany({
    where: { createdById: { in: demoUserIds } },
    select: { id: true },
  });
  const allDemoEnvelopeIds = [
    ...new Set([
      ...demoRecipients.map((r) => r.envelopeId),
      ...demoCreatedEnvelopes.map((e) => e.id),
    ]),
  ];

  if (allDemoEnvelopeIds.length > 0) {
    await db.envelopeEvent.deleteMany({ where: { envelopeId: { in: allDemoEnvelopeIds } } });
    await db.recipient.deleteMany({ where: { envelopeId: { in: allDemoEnvelopeIds } } });
    const deletedEnvs = await db.envelope.deleteMany({ where: { id: { in: allDemoEnvelopeIds } } });
    console.log(`Deleted ${deletedEnvs.count} demo envelopes with fake client signers or created by demo users`);
  }

  // Delete documents uploaded by demo users
  if (demoUserIds.length > 0) {
    const userDocs = await db.document.findMany({
      where: { uploadedById: { in: demoUserIds } },
      select: { id: true },
    });
    const userDocIds = userDocs.map((d) => d.id);
    if (userDocIds.length > 0) {
      await db.envelope.updateMany({
        where: { documentId: { in: userDocIds } },
        data: { documentId: null },
      });
      await db.documentPage.deleteMany({ where: { documentId: { in: userDocIds } } });
      const deletedDocs = await db.document.deleteMany({ where: { id: { in: userDocIds } } });
      console.log(`Deleted ${deletedDocs.count} documents uploaded by demo users`);
    }

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
