-- Sealed evidence: seal v2 manifest (src/lib/seal.ts), RFC 3161 seal
-- timestamps (src/lib/tsa.ts), PAdES-signed PDFs (src/lib/signed-pdf.ts),
-- adopted signatures, server-held seal certificate keys and the contract
-- text of template envelopes as sent.
-- Generated with `prisma migrate diff`, plus the data fix at the end.

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN "contractText" TEXT;
ALTER TABLE "Envelope" ADD COLUMN "sealFormat" TEXT;
ALTER TABLE "Envelope" ADD COLUMN "sealManifest" TEXT;
ALTER TABLE "Envelope" ADD COLUMN "sealTimestamp" TEXT;
ALTER TABLE "Envelope" ADD COLUMN "sealTimestampAt" DATETIME;
ALTER TABLE "Envelope" ADD COLUMN "sealTimestampTsa" TEXT;
ALTER TABLE "Envelope" ADD COLUMN "signedPdfAt" DATETIME;
ALTER TABLE "Envelope" ADD COLUMN "signedPdfKey" TEXT;
ALTER TABLE "Envelope" ADD COLUMN "signedPdfLevel" TEXT;
ALTER TABLE "Envelope" ADD COLUMN "signedPdfSha256" TEXT;
ALTER TABLE "Envelope" ADD COLUMN "signedPdfSigner" TEXT;

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN "signatureFont" TEXT;
ALTER TABLE "Recipient" ADD COLUMN "signatureImage" TEXT;
ALTER TABLE "Recipient" ADD COLUMN "signatureMethod" TEXT;
ALTER TABLE "Recipient" ADD COLUMN "signatureSha256" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SigningCertificate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commonName" TEXT NOT NULL,
    "organization" TEXT,
    "email" TEXT,
    "serialNumber" TEXT NOT NULL,
    "thumbprint" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "keyAlgorithm" TEXT NOT NULL DEFAULT 'RSA-2048',
    "signatureAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256',
    "notBefore" DATETIME NOT NULL,
    "notAfter" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "purpose" TEXT NOT NULL DEFAULT 'signing',
    "validityDays" INTEGER NOT NULL DEFAULT 365,
    "pkcs12Base64" TEXT,
    "certificatePem" TEXT,
    "chainPem" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'issued',
    "privateKeyEnc" TEXT,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SigningCertificate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SigningCertificate" ("certificatePem", "commonName", "createdAt", "email", "id", "issuer", "keyAlgorithm", "notAfter", "notBefore", "organization", "pkcs12Base64", "purpose", "revokedAt", "serialNumber", "signatureAlgorithm", "status", "tenantId", "thumbprint", "userId", "validityDays") SELECT "certificatePem", "commonName", "createdAt", "email", "id", "issuer", "keyAlgorithm", "notAfter", "notBefore", "organization", "pkcs12Base64", "purpose", "revokedAt", "serialNumber", "signatureAlgorithm", "status", "tenantId", "thumbprint", "userId", "validityDays" FROM "SigningCertificate";
DROP TABLE "SigningCertificate";
ALTER TABLE "new_SigningCertificate" RENAME TO "SigningCertificate";
CREATE INDEX "SigningCertificate_tenantId_idx" ON "SigningCertificate"("tenantId");
CREATE TABLE "new_TsaConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT 'http://timestamp.digicert.com',
    "hashAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256',
    "authType" TEXT NOT NULL DEFAULT 'none',
    "username" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastTestAt" DATETIME,
    "lastTestStatus" TEXT,
    "lastTestLatencyMs" INTEGER,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TsaConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TsaConfig" ("authType", "enabled", "hashAlgorithm", "id", "lastTestAt", "lastTestLatencyMs", "lastTestStatus", "tenantId", "updatedAt", "url", "username") SELECT "authType", "enabled", "hashAlgorithm", "id", "lastTestAt", "lastTestLatencyMs", "lastTestStatus", "tenantId", "updatedAt", "url", "username" FROM "TsaConfig";
DROP TABLE "TsaConfig";
ALTER TABLE "new_TsaConfig" RENAME TO "TsaConfig";
CREATE UNIQUE INDEX "TsaConfig_tenantId_key" ON "TsaConfig"("tenantId");
CREATE TABLE "new_PlatformSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "smtpHost" TEXT NOT NULL DEFAULT 'smtp.eu.mailprovider.io',
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpUser" TEXT NOT NULL DEFAULT 'notifications@docurama.eu',
    "smtpPassword" TEXT,
    "smtpFrom" TEXT NOT NULL DEFAULT 'Docurama Sign <notifications@docurama.eu>',
    "smtpTls" BOOLEAN NOT NULL DEFAULT true,
    "tsaUrl" TEXT NOT NULL DEFAULT 'http://timestamp.digicert.com',
    "tsaReachable" BOOLEAN NOT NULL DEFAULT true,
    "certFingerprint" TEXT NOT NULL DEFAULT '3A:F2:88:1B:6C:9E:44:D0:A7:2E:5F:B1:C3:98:0D:64:71:AA:29:5C',
    "certExpiryAt" DATETIME NOT NULL,
    "signingConformance" TEXT NOT NULL DEFAULT 'B-LT',
    "trialLengthDays" INTEGER NOT NULL DEFAULT 14,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "featureFlags" TEXT NOT NULL DEFAULT '{"smsDelivery":true,"bulkSend":true,"webhooks":true,"passkeys":true,"aiFieldDetect":false,"euResidencyOnly":false}',
    "provisioningState" TEXT NOT NULL DEFAULT '{}',
    "companyProfile" TEXT,
    "sweeperLastRunAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queueDepth" INTEGER NOT NULL DEFAULT 3,
    "apiReplicas" INTEGER NOT NULL DEFAULT 2,
    "diskUsedPct" INTEGER NOT NULL DEFAULT 41,
    "lastDeployAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" TEXT NOT NULL DEFAULT '0.3.0',
    "auditChainSealedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditChainBlockHeight" INTEGER NOT NULL DEFAULT 1842,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_PlatformSetting" ("apiReplicas", "auditChainBlockHeight", "auditChainSealedAt", "certExpiryAt", "certFingerprint", "companyProfile", "diskUsedPct", "featureFlags", "id", "lastDeployAt", "maintenanceMode", "provisioningState", "queueDepth", "signingConformance", "smtpFrom", "smtpHost", "smtpPassword", "smtpPort", "smtpTls", "smtpUser", "sweeperLastRunAt", "trialLengthDays", "tsaReachable", "tsaUrl", "updatedAt", "version") SELECT "apiReplicas", "auditChainBlockHeight", "auditChainSealedAt", "certExpiryAt", "certFingerprint", "companyProfile", "diskUsedPct", "featureFlags", "id", "lastDeployAt", "maintenanceMode", "provisioningState", "queueDepth", "signingConformance", "smtpFrom", "smtpHost", "smtpPassword", "smtpPort", "smtpTls", "smtpUser", "sweeperLastRunAt", "trialLengthDays", "tsaReachable", "tsaUrl", "updatedAt", "version" FROM "PlatformSetting";
DROP TABLE "PlatformSetting";
ALTER TABLE "new_PlatformSetting" RENAME TO "PlatformSetting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Data: DigiCert serves RFC 3161 over plain HTTP only; its HTTPS endpoint never
-- answers, so stored copies of the old default are moved to the working URL.
UPDATE "PlatformSetting" SET "tsaUrl" = 'http://timestamp.digicert.com' WHERE "tsaUrl" = 'https://timestamp.digicert.com';
UPDATE "TsaConfig" SET "url" = 'http://timestamp.digicert.com' WHERE "url" = 'https://timestamp.digicert.com';
