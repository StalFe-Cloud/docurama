import { db } from "../lib/db";
import { hashPassword } from "../lib/auth-server";

export async function seedDatabase() {
  const adminEmail = process.env.DOCURAMA_BOOTSTRAP_EMAIL || "admin@docurama.local";
  const adminPassword = process.env.DOCURAMA_BOOTSTRAP_PASSWORD || "ChangeMe123!";

  console.log(`Checking database seed for ${adminEmail}...`);

  const existingAdmin = await db.user.findUnique({
    where: { email: adminEmail },
  });

  if (existingAdmin) {
    console.log(`Database already seeded with admin user: ${adminEmail}`);
    return;
  }

  // 1. Create Default Tenant / Workspace
  const tenant = await db.tenant.create({
    data: {
      name: "Docurama SAS",
      slug: "docurama-sas",
      planCode: "BUSINESS",
      status: "ACTIVE",
    },
  });

  // 2. Create Platform Admin User
  const passwordHash = hashPassword(adminPassword);
  const user = await db.user.create({
    data: {
      email: adminEmail,
      passwordHash,
      firstName: "Admin",
      lastName: "Docurama",
      role: "PLATFORM_ADMIN",
      status: "ACTIVE",
      activeTenantId: tenant.id,
      emailVerifiedAt: new Date(),
    },
  });

  // 3. Create Tenant Membership (Owner)
  await db.member.create({
    data: {
      userId: user.id,
      tenantId: tenant.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });

  // 4. Create Initial Audit Event
  await db.auditEvent.create({
    data: {
      actor: `${user.firstName} ${user.lastName}`,
      actorRole: "PLATFORM_ADMIN",
      actorUserId: user.id,
      tenantId: tenant.id,
      tenantName: tenant.name,
      action: "system.bootstrap",
      resource: "database",
      severity: "INFO",
      detail: "Initial platform administrator and workspace provisioned.",
      ip: "127.0.0.1",
    },
  });

  console.log(`Successfully seeded database with admin ${adminEmail} (password: ${adminPassword}) and tenant ${tenant.name}`);
}

// Allow direct execution
if (import.meta.main || process.argv[1]?.endsWith("seed.ts")) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
