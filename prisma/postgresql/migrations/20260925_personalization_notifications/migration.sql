-- Personalization (logo, email templates, after-signing message, redirect,
-- confetti) and branded, workspace-routed outbox mail (HTML body, Reply-To,
-- workspace SMTP). Generated with `prisma migrate diff`.

-- AlterTable
ALTER TABLE "MailOutbox" ADD COLUMN     "bodyHtml" TEXT,
ADD COLUMN     "replyTo" TEXT,
ADD COLUMN     "tenantId" TEXT;
-- CreateTable
CREATE TABLE "Personalization" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "logo" TEXT,
    "logoSha256" TEXT,
    "emailTemplates" TEXT,
    "completedMessage" TEXT,
    "redirectUrl" TEXT,
    "redirectLabel" TEXT,
    "confetti" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Personalization_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "Personalization_tenantId_key" ON "Personalization"("tenantId");
-- CreateIndex
CREATE INDEX "Personalization_logoSha256_idx" ON "Personalization"("logoSha256");
-- AddForeignKey
ALTER TABLE "Personalization" ADD CONSTRAINT "Personalization_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Schema drift carried since 6d6c72c (PlatformSetting.version default changed
-- in the schema without a migration). The SQLite side was corrected when
-- 20260923_sealed_evidence rebuilt that table.
ALTER TABLE "PlatformSetting" ALTER COLUMN "version" SET DEFAULT '0.3.0';
