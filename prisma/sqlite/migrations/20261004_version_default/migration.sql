-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PlatformSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "smtpHost" TEXT NOT NULL DEFAULT 'smtp.eu.mailprovider.io',
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpUser" TEXT NOT NULL DEFAULT 'notifications@docurama.eu',
    "smtpPassword" TEXT,
    "smtpFrom" TEXT NOT NULL DEFAULT 'Docurama Sign <notifications@docurama.eu>',
    "smtpTls" BOOLEAN NOT NULL DEFAULT true,
    "tsaUrl" TEXT NOT NULL DEFAULT 'https://timestamp.digicert.com',
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
