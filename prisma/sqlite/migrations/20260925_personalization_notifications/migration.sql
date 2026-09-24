-- Personalization (logo, email templates, after-signing message, redirect,
-- confetti) and branded, workspace-routed outbox mail (HTML body, Reply-To,
-- workspace SMTP). Generated with `prisma migrate diff`.

-- AlterTable
ALTER TABLE "MailOutbox" ADD COLUMN "bodyHtml" TEXT;
ALTER TABLE "MailOutbox" ADD COLUMN "replyTo" TEXT;
ALTER TABLE "MailOutbox" ADD COLUMN "tenantId" TEXT;
-- CreateTable
CREATE TABLE "Personalization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "logo" TEXT,
    "logoSha256" TEXT,
    "emailTemplates" TEXT,
    "completedMessage" TEXT,
    "redirectUrl" TEXT,
    "redirectLabel" TEXT,
    "confetti" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Personalization_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- CreateIndex
CREATE UNIQUE INDEX "Personalization_tenantId_key" ON "Personalization"("tenantId");
-- CreateIndex
CREATE INDEX "Personalization_logoSha256_idx" ON "Personalization"("logoSha256");
